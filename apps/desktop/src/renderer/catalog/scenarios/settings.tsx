import {
  AccountHeader,
  AttachmentCacheFigures,
  KeyboardShortcutsPage,
  RecoveryPasswordPage,
} from '@session/screens'
import { defineStory, type AnyStory } from '@session/ui/catalog'

/** Made up, never an account's: the fake's thirteen words and a 16-byte seed. */
const CATALOG_SECRET = {
  words:
    'letters mumble ordeal jaded womanly framed jailed sifting january nurse gutter estate jaded'.split(
      ' ',
    ),
  seedHex: '0123456789abcdef0123456789abcdef',
}

/**
 * The longest a recovery password gets: 24 words and a checksum for a 32-byte seed, which makes the
 * tallest word block and the densest code.
 */
const CATALOG_LONG_SECRET = {
  words: [
    ...'letters mumble ordeal jaded womanly framed jailed sifting january nurse gutter estate'.split(
      ' ',
    ),
    ...'tsunami oxygen vowels lymph agnostic nimbly pebbles yanks wetsuit hounded rash bimonthly'.split(
      ' ',
    ),
    'rash',
  ],
  seedHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
}

/** A phone's width, as the settings row's own story draws at. */
const SECTION_WIDTH = 390

/** Desktop's limit, and a usage in the megabytes a few downloads make. No folder, as the fake's. */
const CATALOG_CACHE_SETTINGS = { cacheDir: '', usageBytes: 12_582_912, limitBytes: 5_000_000_000 }

/** Made up, never an account's: a standard Account ID, for the avatar's colour and the code. */
const CATALOG_ACCOUNT_ID = '05b2c7e1d4a8f3906e5c1b7d2a4f8e3c9b6d1a5e7f2c4b8d3a9e6f1c5b7d2a4e8f'

/**
 * The attachment cache's figures, fixed: the showcase's usage moves with whatever its transfers
 * have finished by the time the shot is taken. A right-to-left page sets each size at the leading
 * edge, still number first.
 *
 * The keyboard shortcuts as a Mac and a PC name them. Right to left, the rows mirror and each key
 * combination keeps its order.
 */
export const SETTINGS_SCENARIOS: readonly AnyStory[] = [
  defineStory<Record<string, never>>({
    component: 'settings',
    story: 'attachmentCache',
    width: SECTION_WIDTH,
    sensitive: { rtl: true },
    variants: { resting: {} },
    render: () => <AttachmentCacheFigures settings={CATALOG_CACHE_SETTINGS} />,
  }),
  // The fake's words and seed, never an account's, and the longest a password gets. Both views,
  // since the page cannot be pressed here; at a phone's width, where the Hide row's description
  // wraps beside its button.
  defineStory<{ view: 'words' | 'qr'; long: boolean }>({
    component: 'settings',
    story: 'recoveryPassword',
    width: SECTION_WIDTH,
    sensitive: { rtl: true, theme: true },
    variants: {
      words: { view: 'words', long: false },
      qr: { view: 'qr', long: false },
      'words, 25': { view: 'words', long: true },
      'qr, 32-byte seed': { view: 'qr', long: true },
    },
    render: ({ view, long }) => (
      <RecoveryPasswordPage
        secret={long ? CATALOG_LONG_SECRET : CATALOG_SECRET}
        initialView={view}
      />
    ),
  }),
  defineStory<{ names: 'mac' | 'pc' }>({
    component: 'settings',
    story: 'keyboardShortcuts',
    width: SECTION_WIDTH,
    sensitive: { rtl: true },
    variants: { mac: { names: 'mac' }, pc: { names: 'pc' } },
    render: ({ names }) => <KeyboardShortcutsPage names={names} />,
  }),
  // The top of Settings in each of its three states, since the badges and the picture cannot be
  // pressed here. The code's colours swap with the theme; a right-to-left page moves the badges
  // to the other corner.
  defineStory<{ view: 'avatar' | 'enlargedAvatar' | 'qr' }>({
    component: 'settings',
    story: 'accountHeader',
    width: SECTION_WIDTH,
    sensitive: { rtl: true, theme: true },
    variants: {
      avatar: { view: 'avatar' },
      enlarged: { view: 'enlargedAvatar' },
      qr: { view: 'qr' },
    },
    render: ({ view }) => (
      <AccountHeader sessionId={CATALOG_ACCOUNT_ID} name="Alice" initialView={view} />
    ),
  }),
]
