import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  type ConfigPlugin,
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
} from '@expo/config-plugins'

/**
 * Huawei's push kit, in the Huawei build only, and only when the build is given Huawei's
 * configuration: `SESSION_AGCONNECT_SERVICES_JSON`, a path to the app's agconnect-services.json on
 * the build machine.
 *
 * **Without that file nothing of Huawei's is added**, not even its Maven repository, which
 * F-Droid's scanner would refuse in the build files. The Huawei build is then without push, and
 * Instant shows as not available. With it: HMS Push as a `huawei` dependency, its repository, the
 * sources in `android-huawei/` as the `huawei` source set, and the app id as a resource.
 */

const MARKER = '// Huawei Push Kit: see apps/mobile/plugins/withHms.ts'

/** The version legacy Android uses. */
const HMS_VERSION = '6.13.0.301'

const HMS_REPOSITORY = 'https://developer.huawei.com/repo/'

/** The generated `app/build.gradle` with HMS Push added to the Huawei build, once. */
export function buildGradleWithHms(contents: string): string {
  if (contents.includes(MARKER)) return contents
  const block = /^dependencies \{$/m
  if (!block.test(contents)) throw new Error('app/build.gradle has no dependencies {} block')
  return contents.replace(
    block,
    [
      'dependencies {',
      `    ${MARKER}`,
      `    huaweiImplementation "com.huawei.hms:push:${HMS_VERSION}"`,
      // Optional classes HMS Push refers to, for R8 to resolve when it minifies the Huawei build.
      `    huaweiCompileOnly "com.huawei.hms:hianalytics:6.12.0.301"`,
      `    huaweiCompileOnly "com.huawei.hms:availableupdate:${HMS_VERSION}"`,
      '',
    ].join('\n'),
  )
}

/** The generated root `build.gradle` with Huawei's repository beside the others, once. */
export function projectGradleWithHmsRepository(contents: string): string {
  if (contents.includes(HMS_REPOSITORY)) return contents
  // The first repository's indent, so the line sits in the block as the template writes it.
  const block = /allprojects \{\n\s*repositories \{\n([ \t]*)/
  const match = block.exec(contents)
  if (match === null) throw new Error('build.gradle has no allprojects { repositories {} } block')
  const indent = match[1] ?? ''
  return contents.replace(block, (found) => `${found}maven { url '${HMS_REPOSITORY}' }\n${indent}`)
}

interface AgconnectServices {
  client: { app_id: string; package_name?: string }
}

/** The app id out of an agconnect-services.json, as the two string resources HMS reads. */
export function hmsResources(json: string): string {
  const services = JSON.parse(json) as AgconnectServices
  const appId = services.client.app_id
  if (appId === '') throw new Error('agconnect-services.json has no client.app_id')
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- ${MARKER.slice(3)} -->`,
    '<resources>',
    `    <string name="session_hms_app_id" translatable="false">${appId}</string>`,
    `    <string name="session_hms_app_id_meta" translatable="false">appid=${appId}</string>`,
    '</resources>',
    '',
  ].join('\n')
}

function configPath(): string | null {
  const path = process.env['SESSION_AGCONNECT_SERVICES_JSON']
  if (path === undefined || path === '') return null
  if (!existsSync(path)) throw new Error(`SESSION_AGCONNECT_SERVICES_JSON: no file at ${path}`)
  return path
}

export const withHms: ConfigPlugin = (config) => {
  const path = configPath()
  if (path === null) return config
  const withGradle = withProjectBuildGradle(
    withAppBuildGradle(config, (mod) => {
      mod.modResults.contents = buildGradleWithHms(mod.modResults.contents)
      return mod
    }),
    (mod) => {
      mod.modResults.contents = projectGradleWithHmsRepository(mod.modResults.contents)
      return mod
    },
  )
  return withDangerousMod(withGradle, [
    'android',
    (mod) => {
      const huawei = join(mod.modRequest.platformProjectRoot, 'app', 'src', 'huawei')
      cpSync(join(mod.modRequest.projectRoot, 'android-huawei'), huawei, { recursive: true })
      const values = join(huawei, 'res', 'values')
      mkdirSync(values, { recursive: true })
      writeFileSync(join(values, 'hms.xml'), hmsResources(readFileSync(path, 'utf8')))
      return mod
    },
  ])
}
