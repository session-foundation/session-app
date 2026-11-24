import {
  AccountHeader,
  AttachmentCacheFigures,
  DeveloperRestartBanner,
  DesktopNotificationsContent,
  DeveloperSettingsContent,
  KeyboardShortcutsPage,
  MessageDeliveryContent,
  MobileNotificationsContent,
  NotificationContentChoice,
  NotificationSoundChoice,
  PathStatsCard,
  RecoveryPasswordPage,
  type PathStats,
} from '@session/screens'
import { DEVELOPER_FLAGS, type DeliveryModeOffer } from '@session/app'
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

/** The modes each build offers, as the mobile app lists them. */
const ANDROID_PLAY_OFFERS: readonly DeliveryModeOffer[] = [
  { mode: 'instant', unavailable: null },
  { mode: 'always-connected', unavailable: null },
  { mode: 'periodic', unavailable: null },
  { mode: 'while-open', unavailable: null },
]
const ANDROID_FDROID_OFFERS: readonly DeliveryModeOffer[] = [
  { mode: 'instant', unavailable: 'build' },
  ...ANDROID_PLAY_OFFERS.slice(1),
]
const IOS_OFFERS: readonly DeliveryModeOffer[] = [
  { mode: 'instant', unavailable: null },
  { mode: 'periodic', unavailable: null },
  { mode: 'while-open', unavailable: null },
]

/** For a press the catalog cannot make. */
const noop = (): void => undefined

/** A phone's width, as the settings row's own story draws at. */
const SECTION_WIDTH = 390

/** Desktop's limit, and a usage in the megabytes a few downloads make. No folder, as the fake's. */
const CATALOG_CACHE_SETTINGS = { cacheDir: '', usageBytes: 12_582_912, limitBytes: 5_000_000_000 }

/**
 * The path screen's figures as a busy client has them: under Session Router, timed from pings; and
 * under onion requests, timed from the requests' answers, with no jitter to give; and before any
 * path is built.
 */
const ROUTER_STATS: PathStats = {
  onionRequests: false,
  pathsInUse: 18,
  countriesCrossed: 7,
  entryNodes: 4,
  rebuilt: 2,
  averageMs: 304,
  fastestMs: 188,
  slowestMs: 612,
  jitterMs: 14,
}

const ONION_STATS: PathStats = {
  onionRequests: true,
  pathsInUse: 6,
  countriesCrossed: 5,
  entryNodes: 3,
  rebuilt: 1,
  averageMs: 641,
  fastestMs: 402,
  slowestMs: 1288,
  jitterMs: null,
}

const BUILDING_STATS: PathStats = {
  onionRequests: false,
  pathsInUse: 0,
  countriesCrossed: 0,
  entryNodes: 0,
  rebuilt: 0,
  averageMs: null,
  fastestMs: null,
  slowestMs: null,
  jitterMs: null,
}

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
  // The phones' Notifications page: Android with its channels, Android with notifications turned
  // off in its settings, and iOS, which has no channels and chooses its sound.
  defineStory<{ platform: 'android' | 'android, notifications off' | 'ios' }>({
    component: 'settings',
    story: 'notificationsMobile',
    width: SECTION_WIDTH,
    sensitive: { rtl: true, theme: true },
    variants: {
      android: { platform: 'android' },
      'android, notifications off': { platform: 'android, notifications off' },
      ios: { platform: 'ios' },
    },
    render: ({ platform }) => (
      <MobileNotificationsContent
        deliveryTitle="Google push"
        content="nameAndContent"
        sound={platform === 'ios' ? 'note' : null}
        soundWhenOpen
        notificationsAllowed={platform === 'android, notifications off' ? false : null}
        channels={platform !== 'ios'}
        canOpenSettings
        onDelivery={noop}
        onContent={noop}
        onSound={noop}
        onSoundWhenOpen={noop}
        onChannel={noop}
        onOpenSettings={noop}
      />
    ),
  }),
  // The phones' Notification Content screen: Android with Preview Notification under the choices,
  // and iOS, which has no preview yet.
  defineStory<{ platform: 'android' | 'ios' }>({
    component: 'settings',
    story: 'notificationContent',
    width: SECTION_WIDTH,
    sensitive: { rtl: true, theme: true },
    variants: {
      android: { platform: 'android' },
      ios: { platform: 'ios' },
    },
    render: ({ platform }) => (
      <NotificationContentChoice
        selected="nameOnly"
        canPreview={platform === 'android'}
        onSelect={noop}
        onPreview={noop}
      />
    ),
  }),
  // iOS's Sound screen with a sound other than the default chosen, so the default's mark and the
  // choice are both drawn.
  defineStory<Record<string, never>>({
    component: 'settings',
    story: 'notificationSound',
    width: SECTION_WIDTH,
    sensitive: { rtl: true, theme: true },
    variants: { chosen: {} },
    render: () => <NotificationSoundChoice selected="bamboo" onSelect={noop} />,
  }),
  // The delivery choice as each build offers it: a Play build; an F-Droid build, where Instant is
  // not included and the battery switch shows under Periodic; and iOS, where Background App
  // Refresh is off under Instant.
  defineStory<{ build: 'play' | 'fdroid, periodic' | 'ios, refresh off' }>({
    component: 'settings',
    story: 'messageDelivery',
    width: SECTION_WIDTH,
    sensitive: { rtl: true, theme: true },
    variants: {
      play: { build: 'play' },
      'fdroid, periodic': { build: 'fdroid, periodic' },
      'ios, refresh off': { build: 'ios, refresh off' },
    },
    render: ({ build }) => (
      <MessageDeliveryContent
        offers={
          build === 'play'
            ? ANDROID_PLAY_OFFERS
            : build === 'fdroid, periodic'
              ? ANDROID_FDROID_OFFERS
              : IOS_OFFERS
        }
        pushService={build === 'ios, refresh off' ? 'apple' : build === 'play' ? 'google' : null}
        selected={build === 'fdroid, periodic' ? 'periodic' : 'instant'}
        backgroundAllowed={build === 'ios, refresh off' ? null : false}
        backgroundRefreshOn={build === 'ios, refresh off' ? false : null}
        onSelect={noop}
        onBackgroundActivity={noop}
        onOpenSettings={noop}
      />
    ),
  }),
  // Desktop's page with notifications shown, and turned off, which hides the rest.
  defineStory<{ shown: boolean }>({
    component: 'settings',
    story: 'notificationsDesktop',
    width: SECTION_WIDTH,
    sensitive: { rtl: true },
    variants: { shown: { shown: true }, off: { shown: false } },
    render: ({ shown }) => (
      <DesktopNotificationsContent
        shown={shown}
        content="nameOnly"
        audio={false}
        canPreview
        onShown={noop}
        onContent={noop}
        onAudio={noop}
        onPreview={noop}
      />
    ),
  }),
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
  // How each router's figures read: onion requests' timings are named as responses, and its
  // jitter cannot be measured. Right to left, the figures fill from the other edge.
  defineStory<{ stats: PathStats }>({
    component: 'settings',
    story: 'pathStats',
    width: SECTION_WIDTH,
    sensitive: { rtl: true },
    variants: {
      'session router': { stats: ROUTER_STATS },
      'onion requests': { stats: ONION_STATS },
      building: { stats: BUILDING_STATS },
    },
    render: ({ stats }) => <PathStatsCard stats={stats} />,
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
  // Fixed states rather than the build's flags, which move with the environment the catalog was
  // built in: the first flag switched here and any others at their defaults. At a phone's width,
  // where the descriptions wrap. The restart banner is its own story, since it sits above every
  // Developer Settings screen rather than in one.
  defineStory<Record<string, never>>({
    component: 'settings',
    story: 'developerSettings',
    width: SECTION_WIDTH,
    sensitive: { rtl: true, theme: true },
    variants: { resting: {} },
    render: () => (
      <DeveloperSettingsContent
        flags={DEVELOPER_FLAGS.map((listed, index) =>
          index === 0
            ? { flag: listed, value: true, source: 'toggle' as const }
            : { flag: listed, value: false, source: 'default' as const },
        )}
        canReset
        onDebugModeOff={noop}
        onFlagChange={noop}
        onReset={noop}
      />
    ),
  }),
  // With Restart, as desktop and Android can relaunch, and without, as iOS cannot.
  defineStory<{ relaunch: boolean }>({
    component: 'settings',
    story: 'developerRestartBanner',
    width: SECTION_WIDTH,
    sensitive: { rtl: true, theme: true },
    variants: { 'can relaunch': { relaunch: true }, 'cannot relaunch': { relaunch: false } },
    render: ({ relaunch }) => <DeveloperRestartBanner onRestart={relaunch ? noop : null} />,
  }),
]
