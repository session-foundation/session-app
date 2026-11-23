package org.getsession.qrscanner

import android.Manifest
import android.content.Context
import android.hardware.camera2.CameraManager
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android's QR scanner: a CameraX preview whose frames zxing-cpp decodes. See QrScannerView for why
// this exists rather than expo-camera.
class QrScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QrScanner")

    // The cameras the OS can open, external ones included: the view falls back to whichever one
    // there is. Not `FEATURE_CAMERA_ANY`, which is what the system image declares rather than what
    // is attached: an emulator started with no cameras still reports it.
    Function("hasCamera") {
      val cameras = appContext.reactContext?.getSystemService(Context.CAMERA_SERVICE)
      try {
        (cameras as? CameraManager)?.cameraIdList?.isNotEmpty() == true
      } catch (_: Exception) {
        false
      }
    }

    // The same answer expo-camera's permission hook gives: status, granted, canAskAgain.
    AsyncFunction("getPermissionAsync") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.CAMERA,
      )
    }

    AsyncFunction("requestPermissionAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.CAMERA,
      )
    }

    View(QrScannerView::class) {
      Events("onScan")
      Prop("active") { view: QrScannerView, active: Boolean -> view.setActive(active) }
      OnViewDestroys { view: QrScannerView -> view.release() }
    }
  }
}
