import { conversationFromPath } from '@session/app'
import {
  ConversationScreen,
  ModalHost,
  NewConversationScreen,
  RequestsScreen,
  SessionShell,
  ToastLayer,
  registerStoredAppearance,
  StoredThemeProvider,
  useLocale,
  useTextDirection,
} from '@session/screens'
import { SessionStoreProvider } from '@session/state'
import { ModalStackProvider, ToastProvider } from '@session/ui'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router'

import { RemoveLaunchScreenOnMount } from './launchScreen'
import { DesktopNavProvider } from './nav'
import { store } from './store'

registerStoredAppearance(store)

/**
 * The desktop app.
 *
 * The route table here is one of the three declarations the route-contract test holds
 * together - it scrapes the path of every Route element below, so those strings are load-bearing.
 */
export function App() {
  // Subscribes the whole tree to the app's language. `tr()` reads a module-scope variable, so
  // nothing below re-renders when that changes unless something above it does -- and it has to be
  // here rather than in a provider, because a provider's `children` arrive as an element created
  // by its own parent, and React skips a subtree whose element has not changed.
  useLocale()
  // And mirrors the document with it, where the language is written right to left. The direction
  // it returns is for roots that have to pass it down; this one writes `dir` on the document.
  useTextDirection()

  useEffect(() => {
    // `start`, not `hydrate`: a rejection here has no screen to land on, so the store turns it
    // into state instead. See `start` in `packages/state/src/store.ts`.
    void store.actions.start()
    return () => store.actions.dispose()
  }, [])

  return (
    <SessionStoreProvider store={store}>
      <StoredThemeProvider>
        <RemoveLaunchScreenOnMount />
        <MemoryRouter>
          <DesktopNavProvider>
            <ModalStackProvider>
              <ToastProvider>
                <ModalHost>
                  <Shell />
                </ModalHost>
                <ToastLayer />
              </ToastProvider>
            </ModalStackProvider>
          </DesktopNavProvider>
        </MemoryRouter>
      </StoredThemeProvider>
    </SessionStoreProvider>
  )
}

function Shell() {
  const location = useLocation()
  return (
    <SessionShell
      detail={
        <Routes>
          <Route path="" element={null} />
          <Route path="c/:id" element={<ConversationRoute />} />
          <Route path="new" element={<NewConversationScreen />} />
          <Route path="requests" element={<RequestsScreen />} />
        </Routes>
      }
      hasDetail={location.pathname !== '/'}
      openConversationId={conversationFromPath(location.pathname) ?? undefined}
    />
  )
}

/**
 * Reading the id off the route is this file's job, so the screen itself never has to know
 * which router it is running under.
 */
function ConversationRoute() {
  const { id } = useParams<{ id: string }>()
  if (id === undefined) return null
  return <ConversationScreen conversationId={decodeURIComponent(id)} />
}
