/**
 * Every way Session is built and shipped, by the name each platform reports it as.
 *
 * - **Android**, chosen when the APK is built: one Gradle product flavour each, all under the same
 *   application id. The flavour writes its name into the manifest, where the app reads it back.
 *   - `play`: Google Play.
 *   - `fdroid`: F-Droid.
 *   - `website`: a signed APK from the website.
 *   - `huawei`: Huawei AppGallery.
 * - **iOS**, told apart at runtime: App Store and TestFlight installs are the same binary, promoted
 *   rather than rebuilt, so nothing baked in could separate them.
 *   - `appStore`.
 *   - `testFlight`: a provisioning profile that names no devices, which is the App Store's.
 *   - `adHoc`: a release build whose profile names the devices it may run on.
 *   - `development`: a Debug build, or any build on the simulator.
 *   - `euWeb`, `marketplace`: installed from the web or an alternative marketplace where the EU
 *     allows it. Not reported yet. TODO: Apple's `AppDistributor.current` (MarketplaceKit, iOS
 *     17.4+) tells these apart, but it is asynchronous and the variant is read synchronously at
 *     launch; until that is wired up, or the EU build is marked when it is exported, such an
 *     install reports as `appStore`, which offers a store purchase it cannot make.
 * - **Desktop**: `desktop`, whichever package it came in.
 * - `unknown`: a build that cannot say, such as a dev client made before the variant was reported.
 *   It is treated as having none of the traits below.
 *
 * `EXPO_PUBLIC_SESSION_BUILD_VARIANT` overrides what a build reports, on all three platforms: how a
 * test reaches the screens another variant would show, as legacy's developer setting does. A
 * release must not set it. Each app reads it by its literal name, which is the only form its
 * bundler substitutes.
 */
export const BUILD_VARIANTS = [
  'play',
  'fdroid',
  'website',
  'huawei',
  'appStore',
  'testFlight',
  'adHoc',
  'development',
  'euWeb',
  'marketplace',
  'desktop',
  'unknown',
] as const

export type BuildVariant = (typeof BUILD_VARIANTS)[number]

/** What a variant can and cannot do, which is what a screen asks rather than the variant's name. */
export interface VariantTraits {
  /**
   * The push service behind fast mode, or null where there is none.
   *
   * Which service the build would talk to, not that it does: whether fast mode is on offer is
   * `NotificationsPort.fastModeAvailable`, which also needs registration with the service and, on
   * Android, a device that has the service. See the TODO where each app sets it.
   */
  pushService: 'apple' | 'google' | 'huawei' | null
  /**
   * The store Session Pro can be bought through, or null where it cannot be bought in the app.
   *
   * TestFlight buys through the App Store's sandbox, as legacy's does. Nothing reads this yet: the
   * purchase flow does not exist.
   */
  storePurchase: 'appStore' | 'play' | null
  /** Whether the store's own rating prompt works here. Nothing asks for ratings yet. */
  storeReview: boolean
  /**
   * Whether the app has to say when a newer version is out, because no store updates it. Nothing
   * checks yet.
   */
  checksForUpdates: boolean
}

/** Nothing: where the variant has no store, push service or update channel the app can lean on. */
const NONE: VariantTraits = {
  pushService: null,
  storePurchase: null,
  storeReview: false,
  checksForUpdates: false,
}

/**
 * Every variant's traits. Legacy Android varies push, Pro purchase and rating prompts by
 * flavour.
 */
export const VARIANT_TRAITS: Readonly<Record<BuildVariant, Readonly<VariantTraits>>> = {
  play: {
    pushService: 'google',
    storePurchase: 'play',
    storeReview: true,
    checksForUpdates: false,
  },
  // No Google code at all, unlike legacy's F-Droid build, which carries Firebase: F-Droid's own
  // repository accepts only fully open-source builds. So no push service; notifications come from
  // polling.
  fdroid: NONE,
  // As F-Droid, with nothing to update it.
  website: { ...NONE, checksForUpdates: true },
  huawei: { ...NONE, pushService: 'huawei' },
  appStore: {
    pushService: 'apple',
    storePurchase: 'appStore',
    storeReview: true,
    checksForUpdates: false,
  },
  testFlight: { ...NONE, pushService: 'apple', storePurchase: 'appStore' },
  adHoc: { ...NONE, pushService: 'apple' },
  development: { ...NONE, pushService: 'apple' },
  // TODO: how Pro is bought outside the App Store, and how this build learns of an update and
  // where it sends people for it. Both wait on the EU build being set up.
  euWeb: { ...NONE, pushService: 'apple', checksForUpdates: true },
  // The marketplace updates it. TODO: how Pro is bought there, as for `euWeb`.
  marketplace: { ...NONE, pushService: 'apple' },
  // TODO: say which package updates itself and which a store or a package manager updates, once
  // the desktop packages exist; until then each is taken as having to check.
  desktop: { ...NONE, checksForUpdates: true },
  unknown: NONE,
}

function isBuildVariant(value: string): value is BuildVariant {
  return (BUILD_VARIANTS as readonly string[]).includes(value)
}

/**
 * The variant a build reports: `override` when it names one, otherwise what the platform
 * `detected`, otherwise `unknown`.
 *
 * An override that names no variant is ignored, as a flag's is: a typo in a build script should
 * not stop the app starting, and the logs' Variant row shows what was used.
 */
export function resolveBuildVariant(
  override: string | null | undefined,
  detected: string | null | undefined,
): BuildVariant {
  const named = override?.trim()
  if (named && isBuildVariant(named)) return named
  return detected && isBuildVariant(detected) ? detected : 'unknown'
}
