import { flag } from '@session/app'
import { tr } from '@session/localization'
import { useSessionActions } from '@session/state'
import { useToast } from '@session/ui'
import { useRef } from 'react'

/** How many presses on the build stamp turn debug mode on. */
const PRESSES_FOR_DEBUG = 10

/**
 * The build stamp's press handler, the same on every platform: the tenth press turns debug mode on
 * and stores it, as legacy iOS's version taps do, and a toast says so. Only its switch in Developer
 * Settings turns it off, since that also puts the other switches back.
 */
export function useDebugModePresses(): () => void {
  const toasts = useToast()
  const actions = useSessionActions()
  const presses = useRef(0)
  return () => {
    presses.current += 1
    if (presses.current < PRESSES_FOR_DEBUG) return
    presses.current = 0
    if (flag('debugMode')) return
    void actions
      .setFlagToggle('debugMode', true)
      .then(() => toasts.show(tr('debugModeEnabled'), { id: 'debug-mode' }))
  }
}
