import { requirePorts } from '@session/app'

/**
 * Ends the process after a device whose account was loaded has been cleared.
 *
 * Clearing removes the files, but the account's messages and names have sat in JavaScript strings
 * that nothing can scrub; only the end of the process gives that memory back. A relaunch where the
 * platform has one, so the person lands on onboarding; otherwise the app closes. Only after a
 * clear that succeeded: one that failed has a reason to show.
 */
export function endAfterClear(): void {
  const { restart, close } = requirePorts().window
  const end = restart ?? close
  end?.()
}

/**
 * The startup-failure screen's clear. Where an account had been loaded, which is where a failed
 * Settings > Clear data lands, it ends the process as that does; otherwise the store starts again
 * in place, on onboarding.
 */
export function clearAfterStartupFailure(
  clear: () => Promise<void>,
  accountLoaded: boolean,
): Promise<void> {
  return accountLoaded ? clear().then(endAfterClear) : clear()
}
