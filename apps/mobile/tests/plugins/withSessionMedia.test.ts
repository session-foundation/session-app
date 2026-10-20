import type { ExportedConfig } from '@expo/config-plugins'
import { describe, expect, it } from 'vitest'

import { mainApplicationServingMedia, withSessionMedia } from '#plugins/withSessionMedia'

/**
 * SDK 57's template, cut down to the lines the rewrite reads. `PackageList(this)` sits in a `lazy`
 * lambda, which has no receiver, so `this` is the Application `packageConfig` takes.
 */
const KOTLIN = `package org.getsession.session2

import android.app.Application
import com.facebook.react.PackageList

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // add(MyReactNativePackage())
        }
    )
  }
}
`

const JAVA = KOTLIN.replace('PackageList(this)', 'new PackageList(this)')

describe('handing Fresco the media configuration', () => {
  it('rewrites the Kotlin template once, with the import under the package line', () => {
    const out = mainApplicationServingMedia(KOTLIN, 'kt')
    expect(out).toContain('PackageList(this, SessionMedia.packageConfig(this)).packages')
    expect(out.split('SessionMedia.packageConfig').length - 1).toBe(1)
    expect(
      out.startsWith('package org.getsession.session2\n\nimport session.bridge.rn.SessionMedia\n'),
    ).toBe(true)
  })

  it('leaves a template it already rewrote alone', () => {
    const once = mainApplicationServingMedia(KOTLIN, 'kt')
    expect(mainApplicationServingMedia(once, 'kt')).toBe(once)
  })

  it('refuses a Java template rather than writing Kotlin into it', () => {
    expect(() => mainApplicationServingMedia(JAVA, 'java')).toThrow('PackageList(this)')
  })

  it('refuses a template without the call rather than shipping an app whose pictures never load', () => {
    const without = KOTLIN.replace('PackageList(this).packages', 'emptyList()')
    expect(() => mainApplicationServingMedia(without, 'kt')).toThrow('PackageList(this)')
  })

  it('is applied as the MainApplication mod', () => {
    const config = withSessionMedia({ name: 'Session', slug: 'session-app' }) as ExportedConfig
    expect(typeof config.mods?.android?.['mainApplication']).toBe('function')
  })
})
