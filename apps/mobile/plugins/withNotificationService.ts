import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  type ConfigPlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} from '@expo/config-plugins'

/**
 * iOS's notification service extension: the target that handles each push while the app is not
 * running, built from `notification-service/` on the shared C++ push handler.
 *
 * It links the same two frameworks the app's bridge pod does (libsession, and the bridge's shim,
 * which holds the push handler), built by `pnpm --filter @session/bridge-rn build:libsession:ios`,
 * and shares the app's app group and keychain group: the database is in the one and its key in the
 * other.
 */

export interface NotificationServiceOptions {
  /** The app's bundle identifier; the extension's is this plus `.NotificationServiceExtension`. */
  bundleId: string
  appGroup: string
  /**
   * Whether to claim the notification filtering entitlement, which lets the extension show nothing
   * for a push that needs nothing shown. Apple grants it per app on request, and a build claiming
   * it without the grant fails to sign, so it is off unless asked for.
   */
  filtering: boolean
}

const NOTIFICATION_SERVICE_TARGET = 'SessionNotificationService'

/** Where the extension's sources live, relative to apps/mobile. */
const SOURCE_DIR = 'notification-service'

/** The libsession headers the push handler's includes reach, relative to the repository root. */
const HEADER_DIRS = [
  'packages/bridge-core/include',
  'libsession-util/include',
  'libsession-util/external/session-sqlite/include',
  'libsession-util/external/session-sqlite/SQLiteCpp/include',
  'libsession-util/external/protobuf/src',
  'libsession-util/external/session-router/external/nlohmann/single_include',
  'libsession-util/external/session-router/external/oxen-libquic/include',
  'libsession-util/external/session-router/external/oxen-mq/oxen-encoding',
  'libsession-util/external/session-router/external/oxen-mq/oxen-logging/fmt/include',
  'libsession-util/external/session-router/external/oxen-mq/oxen-logging/include',
  'libsession-util/external/session-router/external/oxen-mq/oxen-logging/spdlog/include',
]

const FRAMEWORKS = [
  'packages/bridge-rn/ios/libsession-util.xcframework',
  'packages/bridge-rn/ios/SessionBridgeCore.xcframework',
]

const SYSTEM_FRAMEWORKS = [
  'UserNotifications',
  'Security',
  'SystemConfiguration',
  'ImageIO',
  'CoreGraphics',
  'CoreFoundation',
  'Network',
]

/** The extension's entitlements: the app's groups, and filtering where it has been granted. */
export function extensionEntitlements(options: NotificationServiceOptions): string {
  const filtering = options.filtering
    ? '  <key>com.apple.developer.usernotifications.filtering</key><true/>\n'
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${filtering}  <key>com.apple.security.application-groups</key>
  <array><string>${options.appGroup}</string></array>
  <key>keychain-access-groups</key>
  <array><string>$(AppIdentifierPrefix)${options.bundleId}</string></array>
</dict>
</plist>
`
}

/** The parts of the `xcode` library's project this uses, which ships no types of its own. */
interface BuildConfiguration {
  buildSettings: Record<string, unknown>
}
interface XcodeProject {
  pbxTargetByName(name: string): unknown
  addTarget(name: string, type: string, subfolder: string, bundleId: string): { uuid: string }
  addPbxGroup(files: string[], name: string, path: string): { uuid: string }
  getFirstProject(): { firstProject: { mainGroup: string } }
  addToPbxGroup(group: string, parent: string): void
  addBuildPhase(files: string[], type: string, name: string, target: string): void
  addFramework(path: string, options: Record<string, unknown>): void
  pbxXCBuildConfigurationSection(): Record<string, BuildConfiguration | string>
}

const quoted = (value: string) => `"${value}"`

export const withNotificationService: ConfigPlugin<NotificationServiceOptions> = (
  config,
  options,
) => {
  // The app receives the pushes the extension handles: APNs needs the app entitled to it. Xcode's
  // export rewrites the environment for a distribution build.
  const entitled = withEntitlementsPlist(config, (mod) => {
    mod.modResults['aps-environment'] = 'development'
    return mod
  })

  const withSources = withDangerousMod(entitled, [
    'ios',
    (mod) => {
      const target = join(mod.modRequest.platformProjectRoot, NOTIFICATION_SERVICE_TARGET)
      const source = join(mod.modRequest.projectRoot, SOURCE_DIR)
      mkdirSync(target, { recursive: true })
      for (const file of ['NotificationService.mm', 'PushWords.generated.h', 'Info.plist']) {
        copyFileSync(join(source, file), join(target, file))
      }
      writeFileSync(
        join(target, `${NOTIFICATION_SERVICE_TARGET}.entitlements`),
        extensionEntitlements(options),
      )
      return mod
    },
  ])

  return withXcodeProject(withSources, (mod) => {
    const project = mod.modResults as unknown as XcodeProject
    const name = NOTIFICATION_SERVICE_TARGET
    if (project.pbxTargetByName(name) !== null) return mod

    const iosRoot = mod.modRequest.platformProjectRoot
    const repoRoot = join(mod.modRequest.projectRoot, '..', '..')
    const fromSrcRoot = (path: string) => `$(SRCROOT)/${relative(iosRoot, join(repoRoot, path))}`

    const target = project.addTarget(
      name,
      'app_extension',
      name,
      `${options.bundleId}.NotificationServiceExtension`,
    )
    const group = project.addPbxGroup(
      ['NotificationService.mm', 'PushWords.generated.h', 'Info.plist', `${name}.entitlements`],
      name,
      name,
    )
    const mainGroup = project.getFirstProject().firstProject.mainGroup
    project.addToPbxGroup(group.uuid, mainGroup)

    project.addBuildPhase(
      ['NotificationService.mm'],
      'PBXSourcesBuildPhase',
      'Sources',
      target.uuid,
    )
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid)
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid)
    for (const framework of SYSTEM_FRAMEWORKS) {
      project.addFramework(`System/Library/Frameworks/${framework}.framework`, {
        target: target.uuid,
        sourceTree: 'SDKROOT',
      })
    }
    for (const framework of FRAMEWORKS) {
      project.addFramework(join(repoRoot, framework), {
        target: target.uuid,
        customFramework: true,
      })
    }

    const settings = {
      PRODUCT_NAME: quoted('$(TARGET_NAME)'),
      PRODUCT_BUNDLE_IDENTIFIER: quoted(`${options.bundleId}.NotificationServiceExtension`),
      INFOPLIST_FILE: quoted(`${name}/Info.plist`),
      CODE_SIGN_ENTITLEMENTS: quoted(`${name}/${name}.entitlements`),
      CODE_SIGN_STYLE: 'Automatic',
      SESSION_APP_GROUP: quoted(options.appGroup),
      IPHONEOS_DEPLOYMENT_TARGET: '16.4',
      TARGETED_DEVICE_FAMILY: quoted('1,2'),
      CLANG_CXX_LANGUAGE_STANDARD: quoted('c++20'),
      CLANG_ENABLE_OBJC_ARC: 'YES',
      HEADER_SEARCH_PATHS: [
        quoted('$(inherited)'),
        ...HEADER_DIRS.map((dir) => quoted(fromSrcRoot(dir))),
      ],
      // What the libsession archive's dependencies expect from the system, as the bridge pod lists.
      OTHER_LDFLAGS: [quoted('$(inherited)'), '"-lresolv"', '"-lz"', '"-lc++"', '"-liconv"'],
      SKIP_INSTALL: 'YES',
      SWIFT_VERSION: '5.0',
      MARKETING_VERSION: '1.0',
      CURRENT_PROJECT_VERSION: '1',
    }
    const configurations = Object.values(project.pbxXCBuildConfigurationSection()).filter(
      (entry): entry is BuildConfiguration => typeof entry === 'object',
    )
    // The app's team, so that the extension signs with the app.
    const team = configurations.find(
      (entry) => entry.buildSettings['DEVELOPMENT_TEAM'] !== undefined,
    )?.buildSettings['DEVELOPMENT_TEAM']
    for (const entry of configurations) {
      if (entry.buildSettings['PRODUCT_NAME'] !== quoted(name)) continue
      Object.assign(
        entry.buildSettings,
        settings,
        team === undefined ? {} : { DEVELOPMENT_TEAM: team },
      )
    }
    return mod
  })
}
