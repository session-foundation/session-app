import type { AnyStory } from '@session/ui/catalog'

import { COMPOSER_SCENARIOS } from './composer'
import { HEADER_SCENARIOS } from './header'
import { MESSAGE_SCENARIOS } from './messages'
import { PAGE_STATUS_SCENARIOS } from './pageStatus'
import { RAIL_SCENARIOS } from './rail'
import { SETTINGS_SCENARIOS } from './settings'
import { SHEET_SCENARIOS } from './sheet'
import { STARTUP_FAILED_SCENARIOS } from './startupFailed'

export { PicturesProvider, ScenarioProvider } from './ScenarioProvider'

/** Stories drawn from the fake's store and its pictures, with `ScenarioProvider` above each. */
export const SCENARIOS: readonly AnyStory[] = [
  ...MESSAGE_SCENARIOS,
  ...COMPOSER_SCENARIOS,
  ...HEADER_SCENARIOS,
  ...RAIL_SCENARIOS,
  ...SHEET_SCENARIOS,
  ...SETTINGS_SCENARIOS,
  ...STARTUP_FAILED_SCENARIOS,
  ...PAGE_STATUS_SCENARIOS,
]
