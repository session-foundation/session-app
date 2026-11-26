import { requirePorts, type NotificationsPort } from '@session/app'
import { useEffect, useState } from 'react'

/** OS state the page shows, read when it opens and again whenever the app comes back. */
interface OsState {
  notificationsAllowed: boolean | null
  backgroundAllowed: boolean | null
  backgroundRefreshOn: boolean | null
}

export function useOsState(notifications: NotificationsPort): OsState {
  const [state, setState] = useState<OsState>({
    notificationsAllowed: null,
    backgroundAllowed: null,
    backgroundRefreshOn: null,
  })
  useEffect(() => {
    let live = true
    const read = async () => {
      const [allowed, background, refresh] = await Promise.all([
        notifications.notificationsAllowed?.() ?? null,
        notifications.backgroundActivity?.allowed() ?? null,
        notifications.backgroundRefreshOn?.() ?? null,
      ])
      if (live) {
        setState({
          notificationsAllowed: allowed,
          backgroundAllowed: background,
          backgroundRefreshOn: refresh,
        })
      }
    }
    void read()
    // Back from the OS's settings, which is where each of these is changed.
    const stop = requirePorts().window.onFocusChange((focused) => {
      if (focused) void read()
    })
    return () => {
      live = false
      stop()
    }
  }, [notifications])
  return state
}
