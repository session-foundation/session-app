import type { AndroidConfig, ExportedConfig } from '@expo/config-plugins'
import { BUILD_VARIANTS } from '@session/app'
import { describe, expect, it } from 'vitest'

import {
  ANDROID_FLAVOURS,
  BUILD_VARIANT_KEY,
  buildGradleWithFlavours,
  manifestNamingVariant,
  withBuildVariants,
} from '#plugins/withBuildVariants'

/** SDK 58's `app/build.gradle`, cut down to the lines around the block the flavours go in. */
const GROOVY = `apply plugin: "com.android.application"

android {
    ndkVersion rootProject.ext.ndkVersion
    namespace 'org.getsession.session2'
    defaultConfig {
        applicationId 'org.getsession.session2'
    }
}
`

function manifest(): AndroidConfig.Manifest.AndroidManifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      application: [{ $: { 'android:name': '.MainApplication' } }],
    },
  }
}

describe('the Android flavours', () => {
  it('are each a build variant the app knows', () => {
    for (const flavour of ANDROID_FLAVOURS) expect(BUILD_VARIANTS).toContain(flavour)
  })

  it('are added once at the top of the android block, each naming itself to the manifest', () => {
    const out = buildGradleWithFlavours(GROOVY, 'groovy')
    expect(out).toContain('android {\n    // Build variants')
    expect(out).toContain('flavorDimensions "distribution"')
    for (const flavour of ANDROID_FLAVOURS) {
      expect(out).toContain(`manifestPlaceholders += [sessionBuildVariant: "${flavour}"]`)
    }
    expect(buildGradleWithFlavours(out, 'groovy')).toBe(out)
  })

  it('leave the application id to the default config, the same for every flavour', () => {
    expect(buildGradleWithFlavours(GROOVY, 'groovy')).not.toMatch(
      /applicationIdSuffix|\s{12}applicationId/,
    )
  })

  it('refuse a Kotlin script or a template without the block, rather than shipping no variant', () => {
    expect(() => buildGradleWithFlavours(GROOVY, 'kt')).toThrow('android {}')
    expect(() => buildGradleWithFlavours('apply plugin: "x"\n', 'groovy')).toThrow('android {}')
  })
})

describe('the manifest entry the flavour is read from', () => {
  it('is added once, carrying the placeholder the flavour fills in', () => {
    const once = manifestNamingVariant(manifest())
    const twice = manifestNamingVariant(once)
    expect(twice.manifest.application?.[0]?.['meta-data']).toEqual([
      { $: { 'android:name': BUILD_VARIANT_KEY, 'android:value': '${sessionBuildVariant}' } },
    ])
  })

  it('is applied with the flavours, as the build.gradle and manifest mods', () => {
    const config = withBuildVariants({ name: 'Session', slug: 'session-app' }) as ExportedConfig
    expect(typeof config.mods?.android?.['appBuildGradle']).toBe('function')
    expect(typeof config.mods?.android?.['manifest']).toBe('function')
  })
})
