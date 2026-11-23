import type { FlagName, FlagSource } from './flags'

/**
 * Developer Settings' words, in English only.
 *
 * The one exception to taking every word from the catalogue: the screen is for the people building
 * and testing the app, reached only in debug mode, and its titles name flags that come and go
 * between builds. Legacy iOS's developer settings are English for the same reason. A word the rest
 * of the app also shows, such as Restart, still comes from the catalogue.
 */

/** A flag Developer Settings offers a switch for. */
export interface DeveloperFlag {
  name: FlagName
  title: string
  /** What it does, and when a change to it applies. */
  description: string
  /**
   * Read only as the app starts, so a change applies after a restart, which the screen's banner
   * then asks for. Such a flag has to be read after the account opens, or no switch reaches it.
   */
  restartRequired: boolean
}

/**
 * The flags the screen lists, in its order. A flag left out keeps its environment variable: the
 * onboarding ones are read before there is an account to store a switch with, and the component
 * catalog replaces the whole app before the account opens.
 */
export const DEVELOPER_FLAGS: readonly DeveloperFlag[] = [
  {
    name: 'disableAnimations',
    title: 'Disable Animations',
    description:
      'Turns off animations and transitions, for automated tests that would otherwise race whatever is still moving. Applies to screens drawn after the change.',
    restartRequired: false,
  },
]

const SOURCE_WORDS: Record<FlagSource, string> = {
  toggle: 'set here',
  environment: 'from the environment',
  default: 'default',
}

export const DEVELOPER_COPY = {
  debugModeTitle: 'Debug Mode',
  debugModeDescription: [
    'Grants access to this screen.',
    '',
    'Turning it off will:',
    '• Put every setting below back to its default',
    '• Hide this screen until debug mode is turned on again',
  ].join('\n'),
  featureFlags: 'Feature Flags',
  resetFlags: 'Reset All Flags',
  /** A flag's state line: its value, and where the value comes from. */
  currentLabel: 'Current:',
  currentValue: (value: boolean, source: FlagSource): string =>
    `${value ? 'Enabled' : 'Disabled'} (${SOURCE_WORDS[source]})`,
} as const
