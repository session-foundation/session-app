import { RecoveryPasswordMark } from '../../Brand'
import { QrCode } from '../../QrCode'
import { QrViewerBody } from '../../QrViewer'
import { defineStory } from '../story'
import { noop } from './shared'

interface QrRow {
  value: string
  sizePx: number
  logo: boolean
}

/** Made-up seeds, never an account's: one 16 bytes long, as a 13-word account's is, one 32. */
const SHORT_SEED = '0123456789abcdef0123456789abcdef'
const LONG_SEED = `${SHORT_SEED}fedcba9876543210fedcba9876543210`
/** The legacy desktop client's size for the code on the page, and a narrow phone's. */
const PAGE_PX = 260
const NARROW_PX = 180

/**
 * Dark modules on a light panel in every theme, which is the point of `surfaceInk` and
 * `surfaceInverted`: a dark theme that drew it light on dark would be the regression this catches.
 * The logo clears its own square rather than sitting over modules.
 */
export const qrCode = defineStory<QrRow>({
  component: 'qrCode',
  story: 'recoveryPassword',
  width: 280,
  sensitive: { theme: true },
  variants: {
    short: { value: SHORT_SEED, sizePx: PAGE_PX, logo: true },
    long: { value: LONG_SEED, sizePx: PAGE_PX, logo: true },
    noLogo: { value: SHORT_SEED, sizePx: PAGE_PX, logo: false },
    narrow: { value: SHORT_SEED, sizePx: NARROW_PX, logo: true },
  },
  render: ({ value, sizePx, logo }) => (
    <QrCode
      value={value}
      sizePx={sizePx}
      logo={logo ? RecoveryPasswordMark : undefined}
      accessibilityLabel="QR code"
    />
  ),
})

/** A made-up Account ID, never an account's. */
const ACCOUNT_ID = `05${SHORT_SEED}${SHORT_SEED}`
/** A phone's window, with the status bar across its top and the home indicator at its foot. */
const PHONE_WIDTH = 390
const PHONE_HEIGHT = 640
const STATUS_BAR_PX = 47
const HOME_INDICATOR_PX = 34

/**
 * The code full screen: alone, as on desktop, with the phones' Share button under it, and the
 * recovery password's, which carries its shield as the code on the page does.
 */
export const qrViewer = defineStory<{ share: boolean; mark?: boolean }>({
  component: 'qrViewer',
  story: 'fullScreen',
  width: PHONE_WIDTH,
  variants: {
    alone: { share: false },
    share: { share: true },
    recoveryPassword: { share: true, mark: true },
  },
  render: ({ share, mark = false }) => (
    <QrViewerBody
      value={mark ? SHORT_SEED : ACCOUNT_ID}
      logo={mark ? RecoveryPasswordMark : undefined}
      width={PHONE_WIDTH}
      height={PHONE_HEIGHT}
      topInsetPx={STATUS_BAR_PX}
      bottomInsetPx={HOME_INDICATOR_PX}
      onClose={noop}
      accessibilityLabel="QR code"
      closeLabel="Close"
      action={share ? { label: 'Share', icon: 'share2', onPress: noop } : undefined}
    />
  ),
})
