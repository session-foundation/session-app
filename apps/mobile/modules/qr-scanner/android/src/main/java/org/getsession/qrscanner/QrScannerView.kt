package org.getsession.qrscanner

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.CameraInfoUnavailableException
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import zxingcpp.BarcodeReader

// The same code is reported again only after this long, so a code held in view is not a stream of
// events but is still picked up again if the screen dropped the first one.
private const val REPEAT_MS = 1_500L

private const val TAG = "QrScanner"

// Back first, as a scanner is pointed away from the person holding it; then front, as on some
// tablets and Chromebooks, which the manifest lets install the app; then any other, such as a USB
// camera.
private val CAMERAS =
  listOf(CameraSelector.DEFAULT_BACK_CAMERA, CameraSelector.DEFAULT_FRONT_CAMERA)

/**
 * A camera preview that reads QR codes out of its own frames.
 *
 * **Not expo-camera, whose Android scanner is Google's ML Kit**: that brings Play Services,
 * Firebase components and Google's telemetry library into the app, which an F-Droid build cannot
 * carry. zxing-cpp is open source (Apache-2.0), on Maven Central, and decodes CameraX frames
 * directly. QR codes only: a scanner that also read barcodes would accept a supermarket label as a
 * recovery phrase and fail somewhere further in.
 */
class QrScannerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onScan by EventDispatcher()

  // A TextureView underneath (`COMPATIBLE`) rather than a SurfaceView: React Native lays out and
  // clips this view like any other, which a SurfaceView's separate window does not follow.
  private val preview =
    PreviewView(context).also {
      it.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
      it.scaleType = PreviewView.ScaleType.FILL_CENTER
      addView(it, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

  private val decoder: ExecutorService = Executors.newSingleThreadExecutor()
  private val reader =
    BarcodeReader(BarcodeReader.Options(formats = setOf(BarcodeReader.Format.QR_CODE)))
  private var provider: ProcessCameraProvider? = null
  private var active = true
  private var released = false
  private var lastText: String? = null
  private var lastAtMs = 0L

  init {
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener(
      {
        if (released) return@addListener
        // Caught here because nothing above this listener would: it runs on the main thread, and
        // a throw there ends the app. No camera then means an empty preview.
        provider =
          try {
            future.get()
          } catch (error: Exception) {
            Log.w(TAG, "CameraX did not start", error)
            null
          }
        bind()
      },
      ContextCompat.getMainExecutor(context),
    )
  }

  fun setActive(value: Boolean) {
    if (active == value) return
    active = value
    bind()
  }

  fun release() {
    released = true
    provider?.unbindAll()
    decoder.shutdown()
  }

  private fun bind() {
    val camera = provider ?: return
    camera.unbindAll()
    if (!active || released) return
    val owner = appContext.currentActivity as? LifecycleOwner ?: return
    val selector =
      CAMERAS.firstOrNull { camera.has(it) }
        ?: camera.availableCameraInfos.firstOrNull()?.cameraSelector
    if (selector == null) {
      Log.w(TAG, "No camera to scan with")
      return
    }
    val shown = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
    val analysis =
      ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()
        .also { it.setAnalyzer(decoder) { image -> image.use { decode(reader.read(it)) } } }
    // Caught for the reason the provider is: from the `active` prop or the listener above, this
    // runs on the main thread.
    try {
      camera.bindToLifecycle(owner, selector, shown, analysis)
    } catch (error: Exception) {
      Log.w(TAG, "The camera could not be started", error)
    }
  }

  private fun ProcessCameraProvider.has(selector: CameraSelector): Boolean =
    try {
      hasCamera(selector)
    } catch (_: CameraInfoUnavailableException) {
      false
    }

  private fun decode(results: List<BarcodeReader.Result>) {
    val text = results.firstNotNullOfOrNull { it.text?.takeIf(String::isNotEmpty) } ?: return
    val now = SystemClock.elapsedRealtime()
    if (text == lastText && now - lastAtMs < REPEAT_MS) return
    lastText = text
    lastAtMs = now
    post { if (!released) onScan(mapOf("data" to text)) }
  }

  // React Native does not lay out children added natively, and the preview adds its own when the
  // camera starts; without this they stay at zero size and nothing is drawn.
  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  private val measureAndLayout = Runnable {
    measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
  }
}
