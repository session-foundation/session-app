import { conversationFromPath, requirePorts, routes } from '@session/app'
import { SessionShell, useLocale } from '@session/screens'
import { useMedia, useTokenColor } from '@session/ui'
import { router, Stack, usePathname } from 'expo-router'
import { useEffect } from 'react'

import { reportOpenConversation } from './pushPresence'

/**
 * The routed screens, inside the shell every platform shares.
 *
 * The routed pane is always the router's navigator, on a phone as much as a tablet: expo-router
 * navigates only while its navigator is mounted, so the list cannot take its place on a phone the
 * way it can on the desktop. The index route draws the list itself there, and the empty detail
 * pane on a tablet, where the shell already has the list beside it. The shell keeps the navigator
 * mounted through a change between one pane and two, so turning a tablet keeps what is open.
 *
 * A native stack rather than a bare `Slot`, so that on a phone opening a screen pushes it in and
 * the edge swipe takes it back, as the platform does everywhere else. Beside the list on a tablet
 * the detail pane changes in place, with no push and no swipe back: what is open is already shown
 * in the list, and going back would only empty the pane.
 */
export function MobileShell() {
  useLocale()
  const pathname = usePathname()
  const openConversation = conversationFromPath(pathname)
  useEffect(() => {
    reportOpenConversation(openConversation)
  }, [openConversation])
  // A tapped notification's conversation, or the requests for a request's, where the platform
  // hands taps over rather than opening a link (iOS).
  useEffect(
    () =>
      requirePorts().notifications.onTap((tap) => {
        router.push(
          tap.kind === 'requests'
            ? routes.requests()
            : routes.conversation(tap.conversationId, tap.messageId),
        )
      }),
    [],
  )
  const twoPanes = useMedia().gtSm
  // The screens draw their own headers and backgrounds; this only shows between them mid-push.
  const background = useTokenColor('$backgroundPrimary')
  return (
    <SessionShell
      detail={
        <Stack
          screenOptions={{
            headerShown: false,
            animation: twoPanes ? 'none' : 'default',
            // Off with the push: with no animation the swipes still pop, back to the empty pane.
            // This turns off iOS 26's full-screen swipe too. `fullScreenGestureEnabled` stays
            // unset: on iOS 18 and earlier it swaps the native edge swipe for a custom one.
            gestureEnabled: !twoPanes,
            contentStyle: { backgroundColor: background },
          }}
        />
      }
      hasDetail
      openConversationId={openConversation ?? undefined}
    />
  )
}
