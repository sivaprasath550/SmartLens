package com.smartlens.app.ui

import android.view.LayoutInflater
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.smartlens.app.R
import com.smartlens.app.data.AppSettings
import com.smartlens.app.data.SettingsStore
import com.smartlens.app.databinding.DialogSettingsBinding
import com.smartlens.app.util.UrlUtils
import kotlinx.coroutines.launch

/** Backend URL, sync interval, search radius and the demo-location switch. */
object SettingsDialog {
    fun show(activity: AppCompatActivity, viewModel: MainViewModel) {
        val binding = DialogSettingsBinding.inflate(LayoutInflater.from(activity))
        val current = viewModel.currentSettings
        val serverDefault = viewModel.state.value.session.intervalSeconds

        binding.inputUrl.setText(current.backendUrl)
        binding.inputInterval.setText(current.intervalSecondsOverride?.toString() ?: "")
        binding.inputIntervalLayout.helperText = "Leave empty to use the server default ($serverDefault s)"
        binding.inputRadius.setText(current.radiusMeters.toString())
        binding.switchDemo.isChecked = current.useDemoLocation

        binding.btnTest.setOnClickListener {
            val url = UrlUtils.normalizeBaseUrl(binding.inputUrl.text?.toString().orEmpty())
            if (url == null) {
                binding.inputUrlLayout.error = activity.getString(R.string.settings_invalid_url)
                return@setOnClickListener
            }
            binding.inputUrlLayout.error = null
            binding.textTestResult.setText(R.string.settings_testing)
            binding.btnTest.isEnabled = false
            activity.lifecycleScope.launch {
                binding.textTestResult.text = viewModel.testConnection(url)
                binding.btnTest.isEnabled = true
            }
        }

        val dialog = MaterialAlertDialogBuilder(activity)
            .setTitle(R.string.settings_title)
            .setView(binding.root)
            .setPositiveButton(R.string.settings_save, null)
            .setNegativeButton(R.string.settings_cancel, null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val url = UrlUtils.normalizeBaseUrl(binding.inputUrl.text?.toString().orEmpty())
                val intervalText = binding.inputInterval.text?.toString()?.trim().orEmpty()
                val interval = intervalText.toIntOrNull()
                val radius = binding.inputRadius.text?.toString()?.trim()?.toIntOrNull()

                binding.inputUrlLayout.error = if (url == null) activity.getString(R.string.settings_invalid_url) else null
                val intervalValid = intervalText.isEmpty() ||
                    (interval != null && interval in SettingsStore.MIN_INTERVAL..SettingsStore.MAX_INTERVAL)
                binding.inputIntervalLayout.error =
                    if (!intervalValid) activity.getString(R.string.settings_invalid_interval) else null
                val radiusValid = radius != null && radius in SettingsStore.MIN_RADIUS..SettingsStore.MAX_RADIUS
                binding.inputRadiusLayout.error =
                    if (!radiusValid) activity.getString(R.string.settings_invalid_radius) else null
                if (url == null || !intervalValid || !radiusValid) return@setOnClickListener

                viewModel.saveSettings(
                    AppSettings(
                        backendUrl = url,
                        intervalSecondsOverride = if (intervalText.isEmpty()) null else interval,
                        radiusMeters = radius!!,
                        useDemoLocation = binding.switchDemo.isChecked,
                    ),
                )
                dialog.dismiss()
            }
        }
        dialog.show()
    }
}
