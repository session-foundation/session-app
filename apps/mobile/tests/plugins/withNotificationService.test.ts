import { describe, expect, it } from 'vitest'

import { extensionEntitlements } from '#plugins/withNotificationService'

const OPTIONS = { bundleId: 'org.getsession.session2', appGroup: 'group.org.getsession.session2' }

describe("the notification extension's entitlements", () => {
  it("share the app's group and keychain group, where the database and its key are", () => {
    const plist = extensionEntitlements({ ...OPTIONS, filtering: false })
    expect(plist).toContain('<string>group.org.getsession.session2</string>')
    expect(plist).toContain('<string>$(AppIdentifierPrefix)org.getsession.session2</string>')
    expect(plist).not.toContain('usernotifications.filtering')
  })

  it('claim notification filtering only when asked, since Apple grants it per app', () => {
    expect(extensionEntitlements({ ...OPTIONS, filtering: true })).toContain(
      '<key>com.apple.developer.usernotifications.filtering</key><true/>',
    )
  })
})
