import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';

/** Receives one live-view JPEG frame from the phone (raw image/jpeg body). */
export async function uploadFrame(req, res) {
  const { sessionService } = req.app.locals.ctx;
  const image = Buffer.isBuffer(req.body) ? req.body : null;
  if (!image) {
    // Validate the session first so an unknown session still reports 404.
    await sessionService.authorize(req.valid.params.id, req.get('x-session-token'));
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Frame body must be a JPEG image (Content-Type: image/jpeg)');
  }
  const seqHeader = req.get('x-frame-seq');
  const seq = seqHeader === undefined ? null : Number(seqHeader);
  if (seq !== null && (!Number.isSafeInteger(seq) || seq < 0)) {
    throw ApiError.badRequest('X-Frame-Seq must be a non-negative integer');
  }
  // The phone sends sensor-oriented frames plus the clockwise rotation the viewer must apply.
  const rotation = Number(req.get('x-frame-rotation') ?? 0);
  if (![0, 90, 180, 270].includes(rotation)) {
    throw ApiError.badRequest('X-Frame-Rotation must be 0, 90, 180 or 270');
  }
  const frame = await sessionService.publishFrame(req.valid.params.id, req.get('x-session-token'), image, {
    seq,
    rotation,
  });
  sendSuccess(
    req,
    res,
    { sessionId: req.valid.params.id, bytes: frame.bytes, receivedAt: frame.receivedAt, dropped: Boolean(frame.dropped) },
    { status: 202, meta: { updatedAt: frame.receivedAt } },
  );
}

/** Latest live-view frame as image/jpeg (dashboard initial load and polling fallback). */
export async function getLatestFrame(req, res) {
  const { sessionService } = req.app.locals.ctx;
  const sessionId = req.valid.params.id;
  await sessionService.requireSession(sessionId);
  const frame = sessionService.latestFrame(sessionId);
  if (!frame) throw ApiError.notFound('FRAME_NOT_AVAILABLE', 'No live-view frame has been shared for this session');
  res.set({
    'Content-Type': frame.mimeType,
    'Cache-Control': 'no-store',
    'X-Frame-Received-At': frame.receivedAt,
    'X-Frame-Rotation': String(frame.rotation),
  });
  res.status(200).send(frame.image);
}
