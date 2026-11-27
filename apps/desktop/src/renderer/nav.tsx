import { NavProvider, requirePorts, routes, type NavPort } from '@session/app'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'

/**
 * react-router, behind the port.
 *
 * This file is the only place in the desktop app that knows which router it uses; the
 * screens ask for a NavPort and get one. A clicked notification navigates from here too: it is
 * the one place that can, outside any screen.
 */
export function DesktopNavProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()

  const nav = useMemo<NavPort>(
    () => ({
      push: (path) => void navigate(path),
      replace: (path) => void navigate(path, { replace: true }),
      back: () => void navigate(-1),
    }),
    [navigate],
  )

  useEffect(
    () =>
      requirePorts().notifications.onTap((tap) => {
        void navigate(
          tap.kind === 'requests'
            ? routes.requests()
            : routes.conversation(tap.conversationId, tap.messageId),
        )
      }),
    [navigate],
  )

  return <NavProvider nav={nav}>{children}</NavProvider>
}
