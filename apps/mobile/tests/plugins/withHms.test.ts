import { describe, expect, it } from 'vitest'

import { buildGradleWithHms, hmsResources, projectGradleWithHmsRepository } from '#plugins/withHms'

const APP_GRADLE = `android {
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`

const PROJECT_GRADLE = `buildscript {
  repositories {
    google()
  }
}

allprojects {
  repositories {
    google()
    mavenCentral()
  }
}
`

describe("Huawei's push kit in the Huawei build", () => {
  it('is a huawei-only dependency, added once', () => {
    const once = buildGradleWithHms(APP_GRADLE)
    expect(once).toContain('huaweiImplementation "com.huawei.hms:push:')
    expect(once).not.toMatch(/^\s*implementation "com\.huawei/m)
    expect(buildGradleWithHms(once)).toBe(once)
  })

  it("adds Huawei's repository for every project, once", () => {
    const once = projectGradleWithHmsRepository(PROJECT_GRADLE)
    expect(once).toMatch(
      /allprojects \{\n {2}repositories \{\n {4}maven \{ url 'https:\/\/developer\.huawei\.com\/repo\/' \}\n {4}google\(\)/,
    )
    expect(projectGradleWithHmsRepository(once)).toBe(once)
  })

  it('takes the app id HMS identifies the app by', () => {
    const xml = hmsResources(JSON.stringify({ client: { app_id: '1234' } }))
    expect(xml).toContain('<string name="session_hms_app_id" translatable="false">1234</string>')
    expect(xml).toContain('>appid=1234</string>')
  })
})
