import { CameraProvider, type CameraPort } from '@session/app'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'

import { readCameraAccess, type CameraPermission } from './cameraAccess'
import { QrScanner } from './qrScanner'
import { QrScannerView } from './qrScannerView'

/**
 * Android's camera, behind the port: `modules/qr-scanner`, not expo-camera.
 *
 * **expo-camera reads QR codes on Android with Google's ML Kit**, which brings Play Services,
 * Firebase components and Google's telemetry library into the app. The F-Droid build has to be
 * entirely open source, so Android scans with zxing-cpp instead, on every build: one scanner to
 * maintain, and the codes it reads are high-contrast QR codes on another screen. iOS keeps
 * expo-camera (`camera.tsx`), which uses Apple's own scanner. expo-camera is excluded from Android
 * autolinking in package.json, so nothing of it is in the APK.
 */
export function MobileCameraProvider({ children }: { children: ReactNode }) {
  // Read once: a camera that is plugged in later is seen the next time the app starts.
  const [available] = useState(() => QrScanner.hasCamera())
  const [permission, setPermission] = useState<CameraPermission | null>(null)

  // Read again whenever the app comes back: the person may have granted it in Settings meanwhile.
  useEffect(() => {
    const read = () => {
      void QrScanner.getPermissionAsync().then(setPermission)
    }
    read()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') read()
    })
    return () => {
      subscription.remove()
    }
  }, [])

  const request = useCallback(async () => {
    const answer = await QrScanner.requestPermissionAsync()
    setPermission(answer)
    return answer
  }, [])

  const camera = useMemo<CameraPort>(
    () => ({
      available,
      access: readCameraAccess(permission),
      request: async () => readCameraAccess(await request()),
      Preview: ({ onScan, active = true, testID }) => (
        <QrScannerView
          style={{ flex: 1 }}
          // Stopped rather than unmounted, because the pager keeps every page mounted on purpose.
          active={active}
          onScan={({ nativeEvent }) => {
            onScan(nativeEvent.data)
          }}
          testID={testID}
        />
      ),
    }),
    [available, permission, request],
  )

  return <CameraProvider camera={camera}>{children}</CameraProvider>
}
