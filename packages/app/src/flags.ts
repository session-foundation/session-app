import { requirePorts } from './ports'

/**
 * Feature flags, and the environment variables that override them.
 *
 * Two halves on purpose: the **defaults** live here so every platform agrees what a flag means,
 * and the **override** is a port, because the three platforms expose the environment differently.
 *
 * Every flag is overridable on all three. A flag that can only be flipped by editing source cannot
 * be used to bisect a bug on somebody else's device, which is most of what a flag is for. One that
 * genuinely cannot be has to say why here.
 *
 * **Desktop reads them at launch only where unpackaged**: main carries them to the renderer, which
 * cannot read an environment. A packaged build has only what was substituted into its bundle, so
 * there a change is a rebuild. See `flags` in the renderer's ports.
 */

export const FLAGS = {
  /**
   * Whether a thirteen-word recovery phrase may be created.
   *
   * On, because it is what every shipped client makes and the only length they can all restore.
   */
  recoveryPhraseShort: true,

  /**
   * Whether a twenty-five-word recovery phrase may be created.
   *
   * Off, because a longer phrase is not restorable by older clients: somebody who picks one and
   * later restores on a legacy build has an account they cannot reach.
   *
   * **A length per flag rather than one flag offering a choice**, so the screen can be told which
   * lengths exist rather than whether to show a control. That makes the compatibility question
   * answerable per length: turning the long one on somewhere it can be restored does not mean
   * turning the short one off.
   *
   * Nothing reads either length yet. The phrase is not shown until somebody opens it from the
   * banner inside the app, and that screen is not built -- these are here for it.
   */
  recoveryPhraseLong: false,

  /**
   * Offer a choice of language for the recovery phrase, independent of the app's language.
   *
   * Separate from the length flags because a phrase in another language is the same entropy and
   * restores anywhere with the wordlist, where a longer one is a compatibility break.
   */
  recoveryPhraseLanguage: false,

  /**
   * **Force** the tablet's onboarding on any wide window, rather than only where the OS suspends
   * the app.
   *
   * Named for the forcing, because this is not the switch that decides the design: that is the
   * window's width and the notifications port, and this overrides only the second.
   *
   * A tablet is the desktop layout plus the notification-mode step, and which a build gets is an
   * OS fact rather than a window size. Correct, and it makes the tablet flow unreachable on a
   * desktop -- so the one design nobody can open is the hardest to check. Off by default, since it
   * changes which screens appear.
   */
  forceOnboardingTabletDesign: false,

  /**
   * **Force** Instant to look available, whatever the build can actually do.
   *
   * Availability is a fact about the build -- a direct-download Android has no Play Services -- so
   * the "Recommended" state is unreachable on the machines it is developed on. Changes only what
   * the screen says about the option, never what a notification does.
   */
  forceInstantAvailable: false,

  /**
   * Turn off every animation and transition.
   *
   * For automated tests, which otherwise race whatever is still moving: a screenshot mid-transition
   * differs each run, and a tap aimed at a control that has not settled misses.
   */
  disableAnimations: false,

  /**
   * Debug mode: what reveals Developer Settings, in any build.
   *
   * The environment sets where it starts. Ten presses on the build stamp in settings turn it on,
   * stored with the account as a switched flag, so it stays on across launches; only its own switch
   * at the top of Developer Settings turns it off, and that puts every other switched flag back.
   * Off, because a release build is not a debugging one.
   */
  debugMode: false,

  /**
   * Open the component catalog instead of the app: every story and scenario as a page, for the
   * captures that go to Argos. Off, because a release has no use for it.
   *
   * Desktop alone draws it so far; the variable is read on all three so a mobile catalog needs no
   * new plumbing.
   */
  componentCatalog: false,
} as const

export type FlagName = keyof typeof FLAGS

/** What every flag's variable starts with; see `envVarFor`. */
const FLAG_VARIABLE_PREFIX = 'EXPO_PUBLIC_SESSION_FLAG_'

/**
 * The environment variable a flag reads, derived rather than listed.
 *
 * `recoveryPhraseLong` becomes `EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG`, so a new flag
 * cannot arrive with its variable misspelled, absent, or shared with another flag.
 *
 * **`EXPO_PUBLIC_` on every platform, not only the one that needs it.** Expo inlines a variable
 * into a mobile bundle only under that prefix, and the rest of the app's runtime configuration --
 * the network id, the fake, the router, the file server -- already carries it. One prefix means
 * the desktop config can collect the whole set by it without listing any of them, and there is no
 * translation between what the table derives and what a platform reads.
 */
export function envVarFor(flag: FlagName): string {
  const screamed = flag.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
  return `${FLAG_VARIABLE_PREFIX}${screamed}`
}

/**
 * The startup block's Flags row, from the flag variables a build was made or started with.
 *
 * `name=value` for each flag set, in the table's order, with the value as it was written rather
 * than what it means: a bisect wants to see `debugMode=ture`, which reads as the default. Then any
 * variable carrying the prefix that names no flag, under its own name, so a misspelt one shows
 * rather than passing for nothing set. An empty one is left out: it reads as the default, as an
 * unset one does.
 *
 * Pure, and reads no port: the desktop main process writes this row, and has no ports.
 */
export function flagOverrideRows(
  variables: Readonly<Record<string, string | undefined>>,
): string[] {
  const set = (value: string | undefined): value is string => value !== undefined && value !== ''
  const names = Object.keys(FLAGS) as FlagName[]
  const known = new Set(names.map(envVarFor))
  const flags = names.flatMap((name) => {
    const value = variables[envVarFor(name)]
    return set(value) ? [`${name}=${value}`] : []
  })
  const unknown = Object.entries(variables).flatMap(([variable, value]) =>
    variable.startsWith(FLAG_VARIABLE_PREFIX) && !known.has(variable) && set(value)
      ? [`${variable}=${value} (no such flag)`]
      : [],
  )
  return [...flags, ...unknown.sort()]
}

/**
 * Anything that is unambiguously a person typing "on".
 *
 * Deliberately narrow: an unset variable, an empty one or a typo all fall through to the default
 * rather than silently enabling something.
 */
function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function falsy(value: string): boolean {
  return ['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}

/** Where a flag's value comes from: a developer setting, the environment, or the table. */
export type FlagSource = 'toggle' | 'environment' | 'default'

/**
 * The flags someone has switched in Developer Settings, which win over the environment: the
 * switch starts at whatever the environment says, so a flag turned on there shows as on, and once
 * it is changed the change is what holds. Stored with the account (see `followFlagToggles`), and
 * installed here so `flag` stays synchronous.
 */
let toggles: Partial<Record<FlagName, boolean>> = {}

/** Told whenever the switched flags change, so a screen that reads one can draw again. */
const toggleListeners = new Set<() => void>()

/** Replaces the switched flags; anything not named goes back to the environment or the table. */
export function setFlagToggles(next: Partial<Record<FlagName, boolean>>): void {
  toggles = { ...next }
  for (const listener of toggleListeners) listener()
}

/** Calls `listener` whenever the switched flags change; answers the unsubscribe. */
export function subscribeFlagToggles(listener: () => void): () => void {
  toggleListeners.add(listener)
  return () => {
    toggleListeners.delete(listener)
  }
}

/**
 * Every flag's value as the account opened, which is what anything read once at start is running
 * with. Null until then.
 */
let atLaunch: Record<FlagName, boolean> | null = null

/** Records the values the app is running with; see `followFlagToggles`. */
export function markFlagsLaunched(): void {
  atLaunch = flagSnapshot()
}

/**
 * Whether a flag's value differs from the one the app opened with: for a flag read once at start,
 * whether a restart is needed for the change to apply. False before the account has opened.
 */
export function changedSinceLaunch(name: FlagName): boolean {
  return atLaunch !== null && atLaunch[name] !== flag(name)
}

/** Test seam: forgets the values recorded at launch. */
export function forgetLaunchedFlags(): void {
  atLaunch = null
}

/** The value a flag has without any developer setting: the environment's, else the table's. */
function untoggled(name: FlagName): { value: boolean; source: FlagSource } {
  const override = requirePorts().flags.override(envVarFor(name))
  if (override !== null && truthy(override)) return { value: true, source: 'environment' }
  if (override !== null && falsy(override)) return { value: false, source: 'environment' }
  return { value: FLAGS[name], source: 'default' }
}

/** Where `flag(name)` gets its value from. */
export function flagSource(name: FlagName): FlagSource {
  return toggles[name] === undefined ? untoggled(name).source : 'toggle'
}

/**
 * Whether a flag is on: a developer setting if there is one, then the environment, then the table.
 *
 * Reads the port every call rather than caching, because on mobile the value is live. The lookup
 * is a map read and a string compare, so there is nothing to save by holding it.
 */
export function flag(name: FlagName): boolean {
  return toggles[name] ?? untoggled(name).value
}

/** Every flag and its effective value. For the debug menu, and for a bug report to quote. */
export function flagSnapshot(): Record<FlagName, boolean> {
  const names = Object.keys(FLAGS) as FlagName[]
  return Object.fromEntries(names.map((n) => [n, flag(n)])) as Record<FlagName, boolean>
}
