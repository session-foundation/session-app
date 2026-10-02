import {
  registerStoredAppearance,
  StoredThemeProvider,
  useFirstPaintHeld,
  useTextDirection,
} from '@session/screens'
import { SessionStoreProvider, type SessionStore } from '@session/state'
import { DirectionRoot, FONT_ASSETS, Text, UIProvider, YStack } from '@session/ui'
import { useFonts } from 'expo-font'
import { Slot } from 'expo-router'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { useEffect, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { mobileBackdropBlur } from '../src/backdrop'
import { MobileCameraProvider } from '../src/camera'
import { MobileNavProvider } from '../src/nav'
import { storePromise } from '../src/store'

/**
 * The app shell.
 *
 * The store is created asynchronously because opening the bridge is, so this waits for it
 * before rendering anything that would read from it.
 */
export default function RootLayout() {
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
          // default theme now would be redrawn in the account's a moment later.
          held ? null : (
            <UIProvider backdropBlur={mobileBackdropBlur}>
              <YStack
                flex={1}
                alignItems="center"
                justifyContent="center"
                backgroundColor="$backgroundPrimary"
              >
                <Text tone="secondary">Starting…</Text>
              </YStack>
            </UIProvider>
          )
        ) : (
          <SessionStoreProvider store={store}>
            <StoredThemeProvider backdropBlur={mobileBackdropBlur}>
              <MobileNavProvider>
                <MobileCameraProvider>
                  <DirectionRoot rtl={rtl}>
                    {/* Never keyed on the language: that mirrors the strings by remounting the
                        routed subtree, discarding whatever the screen holds. Each route
                        subscribes with `useLocale` instead. */}
                    <Slot />
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
