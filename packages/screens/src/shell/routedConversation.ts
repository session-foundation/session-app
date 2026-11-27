import { createContext, useContext } from 'react'

/**
 * The conversation the router has on top, as the shell reads it from the route: undefined when the
 * route on top is not a conversation. Null outside a shell, as in a catalog story or a render test,
 * where nothing is routed over a screen.
 */
const RoutedConversationContext = createContext<{ id: string | undefined } | null>(null)

export const RoutedConversationProvider = RoutedConversationContext.Provider

/**
 * Whether this conversation is the route on top. A routed screen stays mounted under one pushed
 * over it, a phone's native stack does not freeze it, and its list still reports its rows as on
 * screen: Message Requests opened from Settings on a tablet, or a notification tapped for another
 * conversation, leaves this one drawn where nobody sees it.
 */
export function useIsRoutedOnTop(conversationId: string): boolean {
  const routed = useContext(RoutedConversationContext)
  return routed === null || routed.id === conversationId
}
