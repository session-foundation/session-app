import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type * as ConfigPlugins from '@expo/config-plugins'
import type { ConfigContext, ExpoConfig } from 'expo/config'

// Through the package's imports map: Expo evaluates this file with node's ESM resolver, which
// needs an extension on a relative path and finds one in the map.
import { withBuildVariants } from '#plugins/withBuildVariants'
import { withSessionMedia } from '#plugins/withSessionMedia'

/**
 * Required rather than imported, because node cannot see half of this module's exports.
 *
 * `@expo/config-plugins` is CommonJS and declares its namespaces -- `IOSConfig` and its siblings
 * -- as property getters, which the static analysis node applies to a CommonJS module does not
 * detect. `import { IOSConfig }` therefore fails at load with "does not provide an export named",
 * while the plain functions beside it import fine. Through `require` they are ordinary properties.
 */
const { AndroidConfig, IOSConfig, withAndroidManifest, withDangerousMod, withXcodeProject } =
  createRequire(import.meta.url)('@expo/config-plugins') as typeof ConfigPlugins

/**
 * A file in the generated catalogue, read as text rather than imported from.
 *
 * Expo evaluates this file in plain node, which cannot load the workspace packages' TypeScript
 * source, and copying the list into `app.json` would be a second one to forget.
 *
 * Every reader below throws when it finds nothing rather than returning nothing, because what that
 * produces -- a settings page with no language row, an English prompt on a Japanese phone -- is
 * invisible from here.
 */
function generated(file: string): string {
  return readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../packages/localization/src/localization-src/generated',
      file,
    ),
    'utf8',
  )
}

/** A TypeScript single-quoted literal's escapes, undone. */
function unquoted(literal: string): string {
  return literal.replace(/\\(.)/g, '$1')
}

/** The locale list, from the catalogue's own identifiers, which are Crowdin's. */
function shippedLocales(): string[] {
  const listed = /crowdinLocales\s*=\s*\[([^\]]*)\]/s.exec(generated('constants.ts'))
  const locales = listed?.[1]?.match(/'([^']+)'/g)?.map((quoted) => quoted.slice(1, -1)) ?? []
  if (locales.length === 0) throw new Error('no locales found in the generated catalogue')
  return locales
}

/**
 * The prompts iOS composes itself, and the catalogue key each one's explanation comes from.
 *
 * These belong to Crowdin like any other user-visible string, but iOS reads them out of the bundle
 * rather than asking the app, so they have to be baked in at build time in every language. Android
 * needs nothing equivalent: there the system supplies the wording and the only copy we own is the
 * screen we draw around the prompt, which goes through `tr()` like everything else.
 *
 * **Declared before the features that need them, deliberately.** iOS kills an app the moment it
 * touches a protected resource with no purpose string, and the crash names neither the resource
 * nor the missing key -- so the cost of declaring one early is a line here, and the cost of
 * forgetting one is a launch-time crash somebody has to bisect.
 *
 * These are the legacy client's seven, which is its complete set: it declares no location, no
 * tracking, and nothing for contacts, calendar, motion or Bluetooth.
 *
 * **Sourced from the catalogue rather than copied from the client's plist**, which matters more
 * than it looks: the client's literals are overridden at build time from the same catalogue, and
 * five of the seven have since gone stale against what it actually ships. Copying the plist would
 * ship strings the client itself stopped showing.
 *
 * `NSLocalNetworkUsageDescription` is declared with the `NSBonjourServices` array it needs, and
 * both are inert until calls arrive: iOS prompts for local networking only when something
 * actually browses for one of those services. The client's service name is a probe rather than a
 * real service -- it browses for it purely to make the prompt appear -- so what is still missing
 * is that browse, and it belongs with the calling code.
 */
const PERMISSION_STRINGS: Record<string, string> = {
  NSCameraUsageDescription: 'cameraGrantAccessDescription',
  NSPhotoLibraryUsageDescription: 'permissionsStorageSend',
  NSPhotoLibraryAddUsageDescription: 'permissionsStorageSave',
  NSMicrophoneUsageDescription: 'permissionsMicrophoneAccessRequiredIos',
  NSAppleMusicUsageDescription: 'permissionsAppleMusic',
  NSFaceIDUsageDescription: 'permissionsFaceId',
  NSLocalNetworkUsageDescription: 'permissionsLocalNetworkAccessRequiredIos',
}

/**
 * The purpose strings a plugin writes, from `englishPermission` below, so the Android permission
 * each one comes with is declared by the same entry. `ios.infoPlist` writes every other one.
 */
const PLUGIN_WRITTEN_KEYS = new Set([
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSMicrophoneUsageDescription',
])

/** The English of one of them, which is what the plist itself carries. */
function englishPermission(plistKey: string): string {
  const key = PERMISSION_STRINGS[plistKey]
  const found = new RegExp(`\\b${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(generated('english.ts'))
  if (!found?.[1]) throw new Error(`${key} not found in the generated catalogue`)
  return unquoted(found[1])
}

/**
 * Every other language's, in the shape `IOSConfig.Locales` writes into `<lang>.lproj`.
 *
 * `translations.ts` is seven megabytes, so it is scanned rather than parsed: each locale opens a
 * two-space-indented block and each string is a four-space-indented line inside it. Only the table
 * of strings taking no arguments is searched, which is why nothing here substitutes `{app_name}` --
 * a string carrying a token is in another table and is not a permission string.
 *
 * Values are escaped here because the writer is not: it interpolates straight into `key =
 * "value";`, where a quotation mark would close the string early.
 */
function permissionLocales(): Record<string, { ios: Record<string, string> }> {
  const catalogue = generated('translations.ts')
  const table = catalogue.slice(
    catalogue.indexOf('export const translationsSimpleNoArgs'),
    catalogue.indexOf('export const translationsSimpleWithArgs'),
  )
  const plistKeys = Object.entries(PERMISSION_STRINGS)
  const locales: Record<string, { ios: Record<string, string> }> = {}
  let locale: string | undefined

  for (const line of table.split('\n')) {
    const opens = /^ {2}'?([\w-]+)'?: \{$/.exec(line)
    if (opens?.[1] !== undefined) {
      locale = opens[1]
      continue
    }
    const entry = /^ {4}(\w+): '((?:[^'\\]|\\.)*)',$/.exec(line)
    const plistKey = plistKeys.find(([, key]) => key === entry?.[1])?.[0]
    if (locale === undefined || entry?.[2] === undefined || plistKey === undefined) continue
    const strings = (locales[locale] ??= { ios: {} }).ios
    strings[plistKey] = unquoted(entry[2]).replace(/[\\"]/g, '\\$&')
  }

  if (Object.keys(locales).length === 0) {
    throw new Error('no permission strings found in the generated catalogue')
  }
  return locales
}

/**
 * Writes those strings into the Xcode project, one `<lang>.lproj/InfoPlist.strings` each.
 *
 * Expo offers this as the config's `locales` field, which is not used because that field drives
 * an Android half as well, and the Android half writes a `strings.xml` per locale whether or not
 * the locale has anything in it -- eighty empty resource folders, which is the app declaring
 * eighty resource locales it has no resources for. So the iOS half is called on its own.
 *
 * A locale with an empty map must never be handed over: the writer stops at the first one it sees
 * and silently skips every locale after it.
 */
const withPermissionStrings: ConfigPlugins.ConfigPlugin = (config) =>
  withXcodeProject(config, async (ios) => {
    ios.modResults = await IOSConfig.Locales.setLocalesAsync(
      { locales: permissionLocales() },
      { projectRoot: ios.modRequest.projectRoot, project: ios.modResults },
    )
    return ios
  })

/**
 * Android storage access cut to what exporting uses: WRITE_EXTERNAL_STORAGE on 9 and below, and
 * nothing from 10, where MediaStore takes the save. expo-media-library, there for iOS, declares it
 * up to 32 with `requestLegacyExternalStorage`. Wraps the config rather than sitting in `plugins`,
 * so it runs after theirs.
 *
 * The entry is written whether or not a plugin declared it: absent, the merged manifest takes
 * WRITE up to 32 from expo-file-system's library manifest, which only `tools:replace` overrides.
 */
const withExportStorageAccess: ConfigPlugins.ConfigPlugin = (config) =>
  withAndroidManifest(config, (android) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(android.modResults)
    delete AndroidConfig.Manifest.getMainApplicationOrThrow(manifest).$[
      'android:requestLegacyExternalStorage'
    ]
    const capped = {
      'android:name': 'android.permission.WRITE_EXTERNAL_STORAGE',
      'android:maxSdkVersion': '28',
      'tools:replace': 'android:maxSdkVersion',
    }
    const permissions = (manifest.manifest['uses-permission'] ??= [])
    const write = permissions.find(({ $ }) => $['android:name'] === capped['android:name'])
    if (write === undefined) permissions.push({ $: capped })
    else Object.assign(write.$, capped)
    android.modResults = manifest
    return android
  })

/**
 * Every place Android keeps an app's files, as its backup rules name them: credential-encrypted
 * storage, then the device-encrypted storage an app can opt into, then external storage.
 */
const BACKUP_DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
  'external',
]

/** One `<exclude>` per domain: the whole of it, since `.` is the domain's own directory. */
const excludeAll = (indent: string): string =>
  BACKUP_DOMAINS.map((domain) => `${indent}<exclude domain="${domain}" path="." />`).join('\n')

/**
 * The rules Android 12 (API 31) and later read: one set for cloud backup and one for
 * device-to-device transfer. **`allowBackup="false"` does not cover the second** -- a phone set up
 * from an old one copies an app's data across regardless, unless these rules say otherwise.
 */
const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludeAll('    ')}
  </cloud-backup>
  <device-transfer>
${excludeAll('    ')}
  </device-transfer>
</data-extraction-rules>
`

/** The rules Android 11 (API 30) and earlier read, for anything that still backs up there. */
const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludeAll('  ')}
</full-backup-content>
`

/**
 * Nothing the app keeps leaves the phone by backup or by transfer to a new one, as on iOS.
 *
 * `allowBackup: false` below turns off backup; these rules close device-to-device transfer, which
 * it does not, and stand in for it should it ever be turned back on. Between them they are the
 * whole of the protection: the data and logs are in `filesDir`, the only place besides the cache
 * that expo-file-system lets JS write -- see `modules/storage-roots`.
 *
 * expo-secure-store would otherwise point the same two attributes at rules of its own, which back
 * up the shared preferences it keeps; it is told not to in the plugin list.
 */
const withNoBackups: ConfigPlugins.ConfigPlugin = (config) =>
  withAndroidManifest(
    withDangerousMod(config, [
      'android',
      (android) => {
        const dir = join(android.modRequest.platformProjectRoot, 'app/src/main/res/xml')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'session_data_extraction_rules.xml'), DATA_EXTRACTION_RULES)
        writeFileSync(join(dir, 'session_backup_rules.xml'), FULL_BACKUP_CONTENT)
        return android
      },
    ]),
    (android) => {
      const application = AndroidConfig.Manifest.getMainApplicationOrThrow(android.modResults)
      application.$['android:dataExtractionRules'] = '@xml/session_data_extraction_rules'
      application.$['android:fullBackupContent'] = '@xml/session_backup_rules'
      return android
    },
  )

/**
 * What a local build's bundle identifier gets on the end.
 *
 * **`-test` by default, and deliberately so.** An identifier is reserved with Apple by the first
 * account that builds it to a device, so a development build carrying the real one can take
 * `org.getsession.session2` against the wrong developer account, quietly and not easily undone. A
 * release sets `SESSION_BUNDLE_SUFFIX=` (empty) to ship the real identifier.
 *
 * Here rather than in the Xcode project, so it survives a prebuild.
 */
const BUNDLE_SUFFIX = process.env['SESSION_BUNDLE_SUFFIX'] ?? '-test'

/** The identifier this build ships under: what `app.json` names, plus the suffix above. */
function bundleId(config: ConfigContext['config']): string {
  return `${config.ios?.bundleIdentifier ?? 'org.getsession.session2'}${BUNDLE_SUFFIX}`
}

/**
 * The app group the data lives in, which a notification extension will share. Follows the bundle
 * identifier for the reason the keychain group does: a `-test` build is not in the unsuffixed
 * group. Each one has to be registered with Apple before a device build can be signed with it.
 */
function appGroup(config: ConfigContext['config']): string {
  return `group.${bundleId(config)}`
}

/** The plugins written in this file, which take the computed config rather than a plugin entry. */
const withLocalPlugins: ConfigPlugins.ConfigPlugin = (config) =>
  withBuildVariants(
    withSessionMedia(withExportStorageAccess(withNoBackups(withPermissionStrings(config)))),
  )

/**
 * `app.json` plus the things that have to be computed.
 *
 * Everything static stays in the JSON, where it is easier to read.
 */
export default ({ config }: ConfigContext): ExpoConfig =>
  withLocalPlugins({
    ...config,
    name: config.name ?? 'Session',
    slug: config.slug ?? 'session-app',
    plugins: [
      ...(config.plugins ?? []),
      // iOS's scanner behind the restore screen's QR tab. Android's is modules/qr-scanner:
      // expo-camera is left out of Android autolinking (package.json), as its scanner there is
      // Google's ML Kit.
      [
        'expo-camera',
        {
          cameraPermission: englishPermission('NSCameraUsageDescription'),
          // The plugin adds RECORD_AUDIO to the Android manifest unless told not to, and a
          // dangerous permission on the store listing wants a reason. The only camera here reads
          // QR codes.
          recordAudioAndroid: false,
        },
      ],
      // iOS saves an exported picture or video to Photos through this. The plugin's own strings
      // would replace the catalogue's, and `false` deletes the key from the plist outright. On
      // Android `modules/media-store` does the saving, and `withExportStorageAccess` trims what
      // this declares there.
      [
        'expo-media-library',
        {
          photosPermission: englishPermission('NSPhotoLibraryUsageDescription'),
          savePhotosPermission: englishPermission('NSPhotoLibraryAddUsageDescription'),
          // Unset, the plugin declares audio too. Images and video are blocked below.
          granularPermissions: ['photo', 'video'],
        },
      ],
      // The photo library half of +. Its purpose strings are the catalogue's: `false` would delete
      // the microphone's, and expo-camera would then write Expo's default English in its place.
      // RECORD_AUDIO stays blocked below.
      [
        'expo-image-picker',
        {
          photosPermission: englishPermission('NSPhotoLibraryUsageDescription'),
          cameraPermission: englishPermission('NSCameraUsageDescription'),
          microphonePermission: englishPermission('NSMicrophoneUsageDescription'),
        },
      ],
      // Legacy Android's floor.
      ['expo-build-properties', { android: { minSdkVersion: 26 } }],
      [
        'expo-splash-screen',
        {
          // The legacy clients' launch screen: the logo on black, at its size there, in every
          // theme -- nothing is known about the account's theme until after it has gone.
          // `imageWidth` sizes a square box the logo is fitted into, and the logo is taller than it
          // is wide, so 64 is what gives legacy's 64-point-tall logo.
          image: './assets/splash-logo.png',
          imageWidth: 64,
          resizeMode: 'contain',
          // The default theme's background; tests/splashColours.test.ts keeps the two equal.
          backgroundColor: '#000000',
        },
      ],
      // Its own backup rules would back up the shared preferences it keeps; withNoBackups writes
      // rules that exclude everything instead. Here rather than as a bare name in app.json, which
      // would apply it with its defaults first and make this entry a no-op: it runs once.
      ['expo-secure-store', { configureAndroidBackup: false }],
    ],
    android: {
      ...config.android,
      // Cloud backup off; withNoBackups closes device-to-device transfer, which this does not.
      allowBackup: false,
      // The media-library plugin declares reading the library, which saving to it never does;
      // Play asks every app declaring them to justify it. On 9 and below WRITE grants READ.
      blockedPermissions: [
        ...(config.android?.blockedPermissions ?? []),
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        'android.permission.READ_EXTERNAL_STORAGE',
        // Without it the system photo picker zeroes a photo's GPS before handing it over. Not
        // where there is none: the document picker it falls back to keeps it.
        'android.permission.ACCESS_MEDIA_LOCATION',
        // A string given for the microphone above declares it; nothing here records audio yet.
        'android.permission.RECORD_AUDIO',
      ],
    },
    ios: {
      ...config.ios,
      bundleIdentifier: bundleId(config),
      entitlements: {
        ...config.ios?.entitlements,
        // **Follows the identifier, because it has to.** The access group is the app's own
        // identifier prefixed by the team, so a `-test` build entitled to the unsuffixed group is
        // entitled to a group it is not in -- and the keychain refuses it. That surfaces as
        // expo-secure-store failing to store the database key, which is the app not starting
        // rather than a warning.
        'keychain-access-groups': [`$(AppIdentifierPrefix)${bundleId(config)}`],
        // Where the data lives: see modules/storage-roots.
        'com.apple.security.application-groups': [appGroup(config)],
      },
      infoPlist: {
        ...config.ios?.infoPlist,
        // Every purpose string the plugins above do not write. English only here;
        // `permissionLocales` puts each of the other languages into its own `.lproj`, keyed off
        // this same map.
        ...Object.fromEntries(
          Object.keys(PERMISSION_STRINGS)
            .filter((plistKey) => !PLUGIN_WRITTEN_KEYS.has(plistKey))
            .map((plistKey) => [plistKey, englishPermission(plistKey)]),
        ),
        // The service the local-network prompt is triggered by. The client's own name, and not a
        // service anything offers: browsing for it is what makes iOS ask, which is the whole
        // reason it is declared. Without this array the usage description above never appears.
        NSBonjourServices: ['_session_local_network_access_check._tcp'],
        /**
         * **What makes iOS offer a per-app language at all**, and what makes the `.lproj` strings
         * above reachable: a bundle is localized for the languages it declares here.
         *
         * Settings shows a Preferred Language row only for a bundle declaring more than one
         * localization. Nothing sends anybody there -- the picker owns the language -- but iOS
         * reports whatever is chosen as the app's effective locale, which is what the picker's
         * *Default* row follows.
         *
         * The catalogue's own identifiers. iOS matches them by the usual BCP-47 rules rather than
         * exactly, so one it does not recognise costs a row in that list and nothing else.
         */
        CFBundleLocalizations: shippedLocales(),
        // The group above, for the storage-roots module to find its container by. Read rather
        // than derived from the bundle identifier there, which an extension's would not match.
        SessionAppGroup: appGroup(config),
      },
    },
  })
