import { CameraProvider, type CameraPort } from '@session/app'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useMemo, useState, type ReactNode } from 'react'

import { readCameraAccess } from './cameraAccess'
import { QrScanner } from './qrScanner'

/**
 * expo-camera, behind the port: iOS's. Android's is `camera.android.tsx`, which does not use
 * expo-camera at all.
 *
 * The preview is a component rather than a call, which is why this is a provider and not a row in
 * `platform.ts`: a camera is something drawn, and the frames it reads QR codes out of never leave
 * the native side.
 */
export function MobileCameraProvider({ children }: { children: ReactNode }) {
  // Read once, as Android's is: see `camera.android.tsx`.
  const [available] = useState(() => QrScanner.hasCamera())
  const [permission, request] = useCameraPermissions()

  const camera = useMemo<CameraPort>(
    () => ({
      available,
      access: readCameraAccess(permission),
      request: async () => readCameraAccess(await request()),
      Preview: ({ onScan, active = true, testID }) => (
        <CameraView
          style={{ flex: 1 }}
          // Stopped rather than unmounted, because the pager keeps every page mounted on purpose.
          active={active}
          facing="back"
          // QR only. A scanner that also read barcodes would happily accept a supermarket label as
          // a recovery phrase and then fail somewhere further in.
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            onScan(data)
          }}
          {...(testID === undefined ? {} : { testID })}
        />
      ),
    }),
    [available, permission, request],
  )

  return <CameraProvider camera={camera}>{children}</CameraProvider>
}
