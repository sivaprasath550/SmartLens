package com.smartlens.app.camera

import android.content.ContentValues
import android.content.Context
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Log
import android.util.Range
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

enum class CameraStatus { OFF, STARTING, ACTIVE, PAUSED, PERMISSION_DENIED, ERROR }

/**
 * Binds a CameraX Preview, ImageCapture and ImageAnalysis to the activity
 * lifecycle. CameraX closes the camera automatically when the activity stops
 * and reopens it when it starts again.
 *
 * Preview frames stay on the phone unless the user turns on "Share live view":
 * only then does [frameListener] receive small, throttled JPEG snapshots.
 */
class CameraController(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
    private val onStatus: (CameraStatus, String?) -> Unit,
) {
    private var provider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var started = false
    private var analysisExecutor: ExecutorService? = null
    private var lastFrameAt = 0L

    /** Receives (JPEG, rotationDegrees) live-view frames on a background thread while non-null. */
    @Volatile
    var frameListener: ((ByteArray, Int) -> Unit)? = null
    private var nv21Buffer: ByteArray? = null
    private var encodedFrames = 0
    private var encodeTimeTotal = 0L
    private var deliveredFrames = 0
    private var statsSince = System.currentTimeMillis()

    private val stateObserver = Observer<CameraState> { state -> onStatus(mapState(state), describeError(state.error)) }

    val isStarted get() = started

    fun start() {
        if (started) return
        started = true
        onStatus(CameraStatus.STARTING, null)
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (!started) return@addListener
            try {
                provider = future.get()
                bind()
            } catch (e: Exception) {
                Log.e(TAG, "Camera provider unavailable", e)
                started = false
                onStatus(CameraStatus.ERROR, "Camera service unavailable on this device")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun bind() {
        val cameraProvider = provider ?: return
        val selector = try {
            when {
                cameraProvider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) -> CameraSelector.DEFAULT_BACK_CAMERA
                cameraProvider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) -> CameraSelector.DEFAULT_FRONT_CAMERA
                else -> null
            }
        } catch (e: Exception) {
            null
        }
        if (selector == null) {
            started = false
            onStatus(CameraStatus.ERROR, "No camera found on this device")
            return
        }

        // A fixed 30 fps sensor rate keeps motion smooth; otherwise auto-exposure
        // drops to ~10 fps in dim light, which made the shared live view stutter.
        val preview = Preview.Builder()
            .setTargetFrameRate(Range(TARGET_FPS, TARGET_FPS))
            .build()
            .also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val capture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()
        val executor = analysisExecutor ?: Executors.newSingleThreadExecutor().also { analysisExecutor = it }
        val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            android.util.Size(640, 480),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                        ),
                    )
                    .build(),
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
            .also { it.setAnalyzer(executor, ::analyze) }

        try {
            cameraProvider.unbindAll()
            val bound = cameraProvider.bindToLifecycle(lifecycleOwner, selector, preview, capture, analysis)
            camera = bound
            imageCapture = capture
            bound.cameraInfo.cameraState.observe(lifecycleOwner, stateObserver)
        } catch (e: Exception) {
            Log.e(TAG, "Camera binding failed", e)
            started = false
            camera = null
            imageCapture = null
            onStatus(CameraStatus.ERROR, "Could not open the camera: ${e.message ?: "unknown error"}")
        }
    }

    /** Encodes at most one frame per [FRAME_INTERVAL_MS], only while someone is listening. */
    private fun analyze(image: ImageProxy) {
        image.use { proxy ->
            val listener = frameListener ?: return
            deliveredFrames++
            val now = System.currentTimeMillis()
            if (now - lastFrameAt < FRAME_INTERVAL_MS) return
            lastFrameAt = now
            try {
                val started = SystemClock.elapsedRealtime()
                val jpeg = encodeJpeg(proxy)
                encodeTimeTotal += SystemClock.elapsedRealtime() - started
                if (++encodedFrames % 60 == 0) {
                    val seconds = (now - statsSince) / 1000f
                    Log.d(
                        TAG,
                        "live view: camera ${"%.1f".format(deliveredFrames / seconds)} fps, " +
                            "avg encode ${encodeTimeTotal / 60} ms, ${jpeg.size / 1024} KB/frame",
                    )
                    encodeTimeTotal = 0
                    deliveredFrames = 0
                    statsSince = now
                }
                // Rotation is applied by the viewer, which is far cheaper than rotating pixels here.
                listener(jpeg, proxy.imageInfo.rotationDegrees)
            } catch (e: Exception) {
                Log.w(TAG, "Live-view frame encoding failed", e)
            }
        }
    }

    /**
     * YUV_420_888 -> NV21 -> JPEG using the platform's native encoder. This
     * avoids RGBA conversion and bitmap work, which were the bottleneck.
     */
    private fun encodeJpeg(proxy: ImageProxy): ByteArray {
        val width = proxy.width
        val height = proxy.height
        val nv21 = toNv21(proxy, width, height)
        val out = ByteArrayOutputStream(32 * 1024)
        YuvImage(nv21, ImageFormat.NV21, width, height, null)
            .compressToJpeg(Rect(0, 0, width, height), FRAME_JPEG_QUALITY, out)
        return out.toByteArray()
    }

    private fun toNv21(proxy: ImageProxy, width: Int, height: Int): ByteArray {
        val ySize = width * height
        val buffer = nv21Buffer?.takeIf { it.size == ySize * 3 / 2 } ?: ByteArray(ySize * 3 / 2).also { nv21Buffer = it }
        val (yPlane, uPlane, vPlane) = proxy.planes

        val y = yPlane.buffer.duplicate()
        if (yPlane.rowStride == width) {
            y.position(0)
            y.get(buffer, 0, ySize)
        } else {
            for (row in 0 until height) {
                y.position(row * yPlane.rowStride)
                y.get(buffer, row * width, width)
            }
        }

        // NV21 chroma is interleaved V,U at quarter resolution.
        val u = uPlane.buffer
        val v = vPlane.buffer
        val chromaRowStride = uPlane.rowStride
        val chromaPixelStride = uPlane.pixelStride
        var pos = ySize
        for (row in 0 until height / 2) {
            val rowStart = row * chromaRowStride
            for (col in 0 until width / 2) {
                val index = rowStart + col * chromaPixelStride
                buffer[pos++] = v.get(index)
                buffer[pos++] = u.get(index)
            }
        }
        // YuvImage encodes synchronously, so the reused buffer is safe to return.
        return buffer
    }

    fun stop() {
        started = false
        camera?.cameraInfo?.cameraState?.removeObserver(stateObserver)
        camera = null
        imageCapture = null
        try {
            provider?.unbindAll()
        } catch (e: Exception) {
            Log.w(TAG, "unbindAll failed", e)
        }
        onStatus(CameraStatus.OFF, null)
    }

    /** Releases the analysis thread; call when the owning Activity is destroyed. */
    fun release() {
        frameListener = null
        analysisExecutor?.shutdown()
        analysisExecutor = null
    }

    /**
     * Saves a JPEG on the device only (Pictures/SmartLens on Android 10+, the
     * app's private Pictures folder on older versions). It is never uploaded.
     */
    fun capturePhoto(onResult: (Result<Uri>) -> Unit) {
        val capture = imageCapture ?: return onResult(Result.failure(IllegalStateException("Camera is not active")))
        val name = "SmartLens_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val options = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/SmartLens")
            }
            ImageCapture.OutputFileOptions.Builder(
                context.contentResolver,
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                values,
            ).build()
        } else {
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: context.filesDir
            ImageCapture.OutputFileOptions.Builder(File(dir, "$name.jpg")).build()
        }
        capture.takePicture(
            options,
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    onResult(Result.success(output.savedUri ?: Uri.EMPTY))
                }

                override fun onError(exception: ImageCaptureException) {
                    Log.e(TAG, "Capture failed", exception)
                    onResult(Result.failure(exception))
                }
            },
        )
    }

    private fun mapState(state: CameraState): CameraStatus {
        if (state.error?.type == CameraState.ErrorType.CRITICAL) return CameraStatus.ERROR
        return when (state.type) {
            CameraState.Type.OPEN -> CameraStatus.ACTIVE
            CameraState.Type.PENDING_OPEN, CameraState.Type.OPENING -> CameraStatus.STARTING
            CameraState.Type.CLOSING, CameraState.Type.CLOSED -> if (started) CameraStatus.PAUSED else CameraStatus.OFF
        }
    }

    private fun describeError(error: CameraState.StateError?): String? = if (error == null) null else when (error.code) {
        CameraState.ERROR_CAMERA_IN_USE, CameraState.ERROR_MAX_CAMERAS_IN_USE -> "The camera is in use by another app"
        CameraState.ERROR_CAMERA_DISABLED -> "The camera is disabled by device policy"
        CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED -> "Camera blocked by Do Not Disturb mode"
        CameraState.ERROR_OTHER_RECOVERABLE_ERROR -> "Camera error, retrying…"
        CameraState.ERROR_STREAM_CONFIG -> "Camera stream configuration failed"
        CameraState.ERROR_CAMERA_FATAL_ERROR -> "Camera stopped due to a fatal error"
        else -> "Camera error (${error.code})"
    }

    companion object {
        private const val TAG = "SmartLensCamera"
        private const val FRAME_INTERVAL_MS = 66L // ~15 frames per second
        private const val TARGET_FPS = 30
        private const val FRAME_JPEG_QUALITY = 60
    }
}
