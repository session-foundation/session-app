import { useSyncExternalStore } from 'react'

import { flag, subscribeFlagToggles } from './flags'

function isOn(): boolean {
  return flag('debugMode')
}

/**
 * Whether debug mode is on, redrawing the caller when a switch turns it over. Stored as a switched
 * flag; see `debugMode` in the flag table.
 */
export function useDebugMode(): boolean {
  return useSyncExternalStore(subscribeFlagToggles, isOn, isOn)
}
