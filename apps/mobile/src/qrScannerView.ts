import { requireNativeView } from 'expo'
import type { ComponentType } from 'react'
import type { ViewStyle } from 'react-native'

export interface QrScannerViewProps {
  style?: ViewStyle | undefined
  /** False stops the camera without unmounting the view. */
  active: boolean
  /**
   * A QR code's text, each time one is read: a code held in view is reported again a moment later.
   */
  onScan: (event: { nativeEvent: { data: string } }) => void
  testID?: string | undefined
}

/**
 * `modules/qr-scanner`'s preview, decoding QR codes from its frames on the native side. Android
 * only, and so apart from the module: iOS registers no view, and this lookup would fail there.
 */
export const QrScannerView: ComponentType<QrScannerViewProps> =
  requireNativeView<QrScannerViewProps>('QrScanner')
