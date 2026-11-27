import { describe, expect, it } from 'vitest'

import { buildGradleWithFirebase, firebaseResources } from '#plugins/withFcm'

/** SDK 58's `app/build.gradle`, cut down to the block Firebase goes in. */
const GROOVY = `android {
    namespace 'org.getsession.session2'
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`

const SERVICES = JSON.stringify({
  project_info: { project_number: '1234', project_id: 'session-test' },
  client: [
    {
      client_info: {
        mobilesdk_app_id: '1:1234:android:other',
        android_client_info: { package_name: 'org.example.other' },
      },
      api_key: [{ current_key: 'other-key' }],
    },
    {
      client_info: {
        mobilesdk_app_id: '1:1234:android:abcd',
        android_client_info: { package_name: 'org.getsession.session2' },
      },
      api_key: [{ current_key: 'key&<1>' }],
    },
  ],
})

describe('Firebase in the Play build', () => {
  it('is a play-only dependency, added once', () => {
    const once = buildGradleWithFirebase(GROOVY)
    expect(once).toMatch(
      /^dependencies \{\n.*\n {4}playImplementation "com\.google\.firebase:firebase-messaging:/m,
    )
    expect(once).not.toMatch(/^\s*implementation "com\.google\.firebase/m)
    expect(buildGradleWithFirebase(once)).toBe(once)
  })

  it('refuses a build file it cannot place the dependency in', () => {
    expect(() => buildGradleWithFirebase('android {\n}\n')).toThrow(/dependencies/)
  })

  it("takes the package's own client, under the names Firebase initialises from", () => {
    const xml = firebaseResources(SERVICES, 'org.getsession.session2')
    expect(xml).toContain(
      '<string name="google_app_id" translatable="false">1:1234:android:abcd</string>',
    )
    expect(xml).toContain(
      '<string name="google_api_key" translatable="false">key&amp;&lt;1&gt;</string>',
    )
    expect(xml).toContain('<string name="project_id" translatable="false">session-test</string>')
    expect(xml).toContain('<string name="gcm_defaultSenderId" translatable="false">1234</string>')
    expect(xml).not.toContain('other')
  })

  it('refuses a file with no client for the package, whose tokens Firebase would refuse', () => {
    expect(() => firebaseResources(SERVICES, 'org.getsession.missing')).toThrow(/no client/)
  })
})
