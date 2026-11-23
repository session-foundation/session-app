import { envVarFor, FLAGS, type FlagName } from '@session/app'

/**
 * The flag overrides this build was started with.
 *
 * **Every variable is named literally, and it has to be.** Expo's transform replaces
 * `process.env.EXPO_PUBLIC_X` only where the source spells the name out; a computed lookup -- what
 * a shared `envVarFor(name)` produces -- is left alone, and `process.env` on a device is very
 * nearly empty, so such a flag can never be set on a phone at all.
 *
 * So the names are repeated here once each. One added to the shared table and forgotten here fails
 * `tests/flagOverrides.test.ts` rather than silently ignoring its variable.
 *
 * `EXPO_PUBLIC_` is the prefix because that is the only one Expo carries into a bundle. Desktop
 * reads the same variable without it.
 */
const OVERRIDES: Record<string, string | undefined> = {
  EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_SHORT:
    process.env.EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_SHORT,
  EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG:
    process.env.EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG,
  EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LANGUAGE:
    process.env.EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LANGUAGE,
  EXPO_PUBLIC_SESSION_FLAG_FORCE_ONBOARDING_TABLET_DESIGN:
    process.env.EXPO_PUBLIC_SESSION_FLAG_FORCE_ONBOARDING_TABLET_DESIGN,
  EXPO_PUBLIC_SESSION_FLAG_FORCE_FAST_MODE_AVAILABLE:
    process.env.EXPO_PUBLIC_SESSION_FLAG_FORCE_FAST_MODE_AVAILABLE,
  EXPO_PUBLIC_SESSION_FLAG_DISABLE_ANIMATIONS:
    process.env.EXPO_PUBLIC_SESSION_FLAG_DISABLE_ANIMATIONS,
  EXPO_PUBLIC_SESSION_FLAG_DEBUG_MODE: process.env.EXPO_PUBLIC_SESSION_FLAG_DEBUG_MODE,
  EXPO_PUBLIC_SESSION_FLAG_COMPONENT_CATALOG:
    process.env.EXPO_PUBLIC_SESSION_FLAG_COMPONENT_CATALOG,
}

/**
 * Every flag variable the bundle was made with, for the startup block's Flags row: the ones above,
 * and any other carrying the prefix, so a misspelt one can be named. metro.config.js collects
 * those into one variable, since no name here could spell them out in advance.
 */
export function flagVariables(): Record<string, string | undefined> {
  let collected: unknown = null
  try {
    collected = JSON.parse(process.env.EXPO_PUBLIC_SESSION_FLAGS ?? '{}')
  } catch {
    // Not written by metro.config.js: the literal names above are all there is.
  }
  const strings =
    typeof collected === 'object' && collected !== null
      ? Object.entries(collected).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )
      : []
  return { ...Object.fromEntries(strings), ...OVERRIDES }
}

/** What the flags port hands back: the override, or nothing set. */
export function flagOverride(name: string): string | null {
  return OVERRIDES[name] ?? null
}

/** The variables this file covers, for the test that says it covers all of them. */
export function overriddenVariables(): string[] {
  return Object.keys(OVERRIDES)
}

/** Every variable the shared table expects a mobile build to read. */
export function expectedVariables(): string[] {
  return (Object.keys(FLAGS) as FlagName[]).map(envVarFor)
}
