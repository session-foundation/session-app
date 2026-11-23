// `AndroidConfig` as a type only: node cannot import its namespaces by name, which app.config.ts
// explains, so the manifest is edited directly rather than through its helpers.
import {
  withAndroidManifest,
  withAppBuildGradle,
  type AndroidConfig,
  type ConfigPlugin,
} from '@expo/config-plugins'

/**
 * The Android product flavours, one per way Session is shipped there, by their names in
 * `BUILD_VARIANTS` in `@session/app`. All four keep the same application id, as legacy's do.
 *
 * Nothing differs between them yet but the name they report. Push code arrives per flavour, so a
 * build without a service never links its library: Firebase only in `play`, HMS only in `huawei`.
 */
export const ANDROID_FLAVOURS = ['play', 'fdroid', 'website', 'huawei'] as const

/** The manifest entry the app reads its flavour from; `SessionLogsModule.kt` names the same key. */
export const BUILD_VARIANT_KEY = 'org.getsession.BUILD_VARIANT'

const PLACEHOLDER = 'sessionBuildVariant'
const MARKER = '// Build variants: see apps/mobile/plugins/withBuildVariants.ts'

/** The flavours, as Groovy, for the top of the template's `android {}` block. */
const FLAVOURS_BLOCK = [
  `    ${MARKER}`,
  '    flavorDimensions "distribution"',
  '    productFlavors {',
  ...ANDROID_FLAVOURS.flatMap((name) => [
    `        ${name} {`,
    '            dimension "distribution"',
    `            manifestPlaceholders += [${PLACEHOLDER}: "${name}"]`,
    '        }',
  ]),
  '    }',
].join('\n')

/**
 * The generated `app/build.gradle` with the flavours added to its `android {}` block.
 *
 * Throws rather than skipping when the template is not Groovy or has no such block, because a
 * template change would otherwise ship an APK that reports no variant. Unchanged once applied.
 */
export function buildGradleWithFlavours(contents: string, language: string): string {
  if (contents.includes(MARKER)) return contents
  const block = /^android \{$/m
  if (language !== 'groovy' || !block.test(contents)) {
    throw new Error('app/build.gradle has no Groovy android {} block to add the flavours to')
  }
  return contents.replace(block, `android {\n${FLAVOURS_BLOCK}\n`)
}

/** The manifest with the entry the flavour's name is substituted into, once. */
export function manifestNamingVariant(
  manifest: AndroidConfig.Manifest.AndroidManifest,
): AndroidConfig.Manifest.AndroidManifest {
  const application = manifest.manifest.application?.[0]
  if (application === undefined) throw new Error('the manifest has no application to name it in')
  const entry = { 'android:name': BUILD_VARIANT_KEY, 'android:value': `\${${PLACEHOLDER}}` }
  const items = (application['meta-data'] ??= [])
  const existing = items.find(({ $ }) => $['android:name'] === BUILD_VARIANT_KEY)
  if (existing === undefined) items.push({ $: entry })
  else existing.$ = entry
  return manifest
}

export const withBuildVariants: ConfigPlugin = (config) =>
  withAndroidManifest(
    withAppBuildGradle(config, (android) => {
      android.modResults.contents = buildGradleWithFlavours(
        android.modResults.contents,
        android.modResults.language,
      )
      return android
    }),
    (android) => {
      android.modResults = manifestNamingVariant(android.modResults)
      return android
    },
  )
