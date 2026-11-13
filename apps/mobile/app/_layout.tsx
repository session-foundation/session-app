import {
  ModalHost,
  registerStoredAppearance,
  StartingScreen,
  StoredThemeProvider,
  ToastLayer,
  useFirstPaintHeld,
  useTextDirection,
} from '@session/screens'
import { SessionStoreProvider, type SessionStore } from '@session/state'
import {
  DirectionRoot,
  FONT_ASSETS,
  HapticsProvider,
  ModalStackProvider,
  ToastProvider,
  UIProvider,
} from '@session/ui'
import { useFonts } from 'expo-font'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { useEffect, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { mobileBackdropBlur } from '../src/backdrop'
import { mobileGlass } from '../src/glass'
import { MobileCameraProvider } from '../src/camera'
import { mobileHaptics } from '../src/haptics'
import { MobileNavProvider } from '../src/nav'
import { MobileShell } from '../src/shell'
import { HideSplashOnMount } from '../src/splash'
import { storePromise } from '../src/store'
import { WindowControlsInsetRoot } from '../src/windowControls'

export default function RootLayout() {
  return (
    <HapticsProvider value={mobileHaptics}>
      <AppTree />
    </HapticsProvider>
  )
}

/**
 * The app shell.
 *
 * The store is created asynchronously because opening the bridge is, so this waits for it
 * before rendering anything that would read from it.
 */
function AppTree() {
  // Subscribes the whole tree to the app's language -- see the note on the desktop root. It has to
  // be the component that creates the subtree, not a provider wrapped around one.
  // And which way that language reads, which `DirectionRoot` below mirrors the tree to.
  const rtl = useTextDirection()

  // Not awaited: nothing waits on a face. Text drawn before it arrives is in the fallback and
  // redraws when it lands, which is better than holding the whole app on a file read.
  useFonts(FONT_ASSETS)

  const [store, setStore] = useState<SessionStore | null>(null)
  const held = useFirstPaintHeld(false)

  useEffect(() => {
    let live = true
    void storePromise.then((created) => {
      if (!live) return
      registerStoredAppearance(created)
      setStore(created)
      // `start`, not `hydrate`: a rejection here has no screen to land on, so the store turns it
      // into state instead. See `start` in `packages/state/src/store.ts`.
      void created.actions.start()
    })
    return () => {
      live = false
    }
  }, [])

  return (
    // The keyboard's own animation progress, read once for the whole tree. Every avoiding view
    // below here is driven from it, which is what lets them move on the keyboard's curve rather
    // than on one of their own.
    <KeyboardProvider>
      <SafeAreaProvider>
        {store === null ? (
          // Held as the provider holds, on the same budget from launch: a placeholder drawn in the
          // default theme now would be redrawn in the account's a moment later. The starting
          // screen rather than anything of its own, so a slow start fades from the splash to the
          // same mark in the same place whichever of the two it reaches.
          held ? null : (
            <UIProvider backdropBlur={mobileBackdropBlur} glass={mobileGlass}>
              <ModalStackProvider>
                <StartingScreen />
              </ModalStackProvider>
              <HideSplashOnMount />
            </UIProvider>
          )
        ) : (
          <SessionStoreProvider store={store}>
            <StoredThemeProvider backdropBlur={mobileBackdropBlur} glass={mobileGlass}>
              <HideSplashOnMount />
              <MobileNavProvider>
                <MobileCameraProvider>
                  <DirectionRoot rtl={rtl}>
                    <ModalStackProvider>
                      {/* Never keyed on the language: that mirrors the strings by remounting the
                          routed subtree, discarding whatever the screen holds. Each route
                          subscribes with `useLocale` instead. */}
                      <ToastProvider>
                        <ModalHost>
                          <WindowControlsInsetRoot>
                            <MobileShell />
                          </WindowControlsInsetRoot>
                        </ModalHost>
                        <ToastLayer />
                      </ToastProvider>
                    </ModalStackProvider>
                  </DirectionRoot>
                </MobileCameraProvider>
              </MobileNavProvider>
            </StoredThemeProvider>
          </SessionStoreProvider>
        )}
      </SafeAreaProvider>
    </KeyboardProvider>
  )
}
