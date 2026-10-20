import { withMainApplication, type ConfigPlugin } from '@expo/config-plugins'

const CALL = 'PackageList(this)'
const CONFIGURED = 'SessionMedia.packageConfig'

/**
 * The generated `MainApplication`, with React Native's Fresco handed the configuration that draws
 * `session-media://` on Android.
 *
 * The only way in: `FrescoModule` takes its configuration from `MainPackageConfig`, and the
 * template builds `PackageList(this)` without one. Throws rather than skipping when the line is
 * not there, or the template is Java, because a template change would otherwise ship an app whose
 * pictures never load. Unchanged once applied, so a second prebuild is not a second import.
 */
export function mainApplicationServingMedia(contents: string, language: string): string {
  if (contents.includes(CONFIGURED)) return contents
  if (language !== 'kt' || !contents.includes(CALL)) {
    throw new Error(`MainApplication has no ${CALL} to hand the media configuration to`)
  }
  return contents
    .replace(CALL, 'PackageList(this, SessionMedia.packageConfig(this))')
    .replace(/^(package .*)$/m, '$1\n\nimport session.bridge.rn.SessionMedia')
}

export const withSessionMedia: ConfigPlugin = (config) =>
  withMainApplication(config, (android) => {
    android.modResults.contents = mainApplicationServingMedia(
      android.modResults.contents,
      android.modResults.language,
    )
    return android
  })
