import { requireNativeModule } from 'expo'

import type { CameraPermission } from './cameraAccess'

/** `modules/qr-scanner`: whether there is a camera, and on Android the permission as well. */
interface QrScannerModule {
  hasCamera(): boolean
  /** Android only: iOS reads the permission through expo-camera. */
  getPermissionAsync(): Promise<CameraPermission>
  /** Android only, as above. */
  requestPermissionAsync(): Promise<CameraPermission>
}

export const QrScanner = requireNativeModule<QrScannerModule>('QrScanner')
