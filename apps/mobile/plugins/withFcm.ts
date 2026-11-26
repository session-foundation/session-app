import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { type ConfigPlugin, withAppBuildGradle, withDangerousMod } from '@expo/config-plugins'

/**
 * Firebase Cloud Messaging, in the Play build only.
 *
 * **Nothing of Google's reaches another build**, not even an unused class: the F-Droid build is
 * entirely open source, and F-Droid's scanner refuses an APK that references Firebase. So the
 * dependency is `playImplementation`, and the code that touches Firebase lives in the `play` source
 * set (copied from `android-play/`), talking to the rest of the app only through
 * `modules/session-push`, which has no Google types in it.
 *
 * **No google-services.json in the repository, and no Google Services Gradle plugin.** The build
 * reads the file named by `SESSION_GOOGLE_SERVICES_JSON` (a path on the build machine) and writes
 * the values Firebase initialises itself from as play-only string resources, which is all that
 * plugin does. A build without it has no FCM: Instant is then unavailable rather than broken.
 */

const MARKER = '// Firebase Cloud Messaging: see apps/mobile/plugins/withFcm.ts'

/** The version legacy Android uses. */
const FIREBASE_MESSAGING = 'com.google.firebase:firebase-messaging:25.0.1'

/** The generated `app/build.gradle` with Firebase added to the Play build's dependencies, once. */
export function buildGradleWithFirebase(contents: string): string {
  if (contents.includes(MARKER)) return contents
  const block = /^dependencies \{$/m
  if (!block.test(contents)) throw new Error('app/build.gradle has no dependencies {} block')
  return contents.replace(
    block,
    `dependencies {\n    ${MARKER}\n    playImplementation "${FIREBASE_MESSAGING}"\n`,
  )
}

interface GoogleServices {
  project_info: { project_number: string; project_id: string }
  client: {
    client_info: { mobilesdk_app_id: string; android_client_info: { package_name: string } }
    api_key: { current_key: string }[]
  }[]
}

/** XML-escaped, for a string resource. */
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'")

/**
 * The Firebase values for `packageName` out of a google-services.json, as an Android string
 * resource file. Throws when the file has no client for the package, which would otherwise give a
 * build whose tokens Firebase refuses.
 */
export function firebaseResources(json: string, packageName: string): string {
  const services = JSON.parse(json) as GoogleServices
  const client = services.client.find(
    (c) => c.client_info.android_client_info.package_name === packageName,
  )
  if (client === undefined) throw new Error(`google-services.json has no client for ${packageName}`)
  const apiKey = client.api_key[0]?.current_key
  if (apiKey === undefined)
    throw new Error(`google-services.json has no API key for ${packageName}`)
  // The names the Google Services plugin would give them, so Firebase initialises itself.
  const values = {
    google_app_id: client.client_info.mobilesdk_app_id,
    google_api_key: apiKey,
    project_id: services.project_info.project_id,
    gcm_defaultSenderId: services.project_info.project_number,
  }
  const items = Object.entries(values)
    .map(
      ([name, value]) =>
        `    <string name="${name}" translatable="false">${escape(value)}</string>`,
    )
    .join('\n')
  const header = `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${MARKER.slice(3)} -->`
  return `${header}\n<resources>\n${items}\n</resources>\n`
}

export const withFcm: ConfigPlugin = (config) =>
  withDangerousMod(
    withAppBuildGradle(config, (android) => {
      android.modResults.contents = buildGradleWithFirebase(android.modResults.contents)
      return android
    }),
    [
      'android',
      (mod) => {
        const play = join(mod.modRequest.platformProjectRoot, 'app', 'src', 'play')
        cpSync(join(mod.modRequest.projectRoot, 'android-play'), play, { recursive: true })
        const path = process.env['SESSION_GOOGLE_SERVICES_JSON']
        const resources = join(play, 'res', 'values', 'firebase.xml')
        if (path !== undefined && path !== '') {
          if (!existsSync(path)) throw new Error(`SESSION_GOOGLE_SERVICES_JSON: no file at ${path}`)
          const packageName = mod.android?.package
          if (packageName === undefined) throw new Error('withFcm needs android.package')
          mkdirSync(dirname(resources), { recursive: true })
          writeFileSync(resources, firebaseResources(readFileSync(path, 'utf8'), packageName))
        }
        return mod
      },
    ],
  )
