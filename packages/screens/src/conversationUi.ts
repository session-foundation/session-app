import type { ConversationId } from '@session/client'
import type { MenuAnchor } from '@session/ui'
import { createContext, useContext } from 'react'

/**
 * What a conversation's messages ask of the screen around them.
 *
 * A context rather than callbacks threaded through every row: the rows are memoised on their ids,
 * and the overlays these open are mounted once, in the screen, rather than once per message.
 */
export interface ConversationUi {
  conversationId: ConversationId
  /** Puts the question to the reader the first time anything is fetched, and never again. */
  requestAutoDownloadPrompt: () => void
  /** `index` is the attachment's index in the message, not its place among the viewable ones. */
  openViewer: (messageId: number, index: number) => void
  openSheet: (messageId: number) => void
  /** A right-click or a long press on a message, or the keyboard on a focused one. */
  openMenu: (messageId: number, anchor: MenuAnchor) => void
  /** Starts a reply to a message of this conversation, in the composer. */
  reply: (messageId: number) => void
  /**
   * What to call whoever wrote a message here, as a quote names its author: worked out once for
   * the screen, so a reply's row reads no account or conversation of its own.
   */
  nameOf: (author: string) => string
}

export const ConversationUiContext = createContext<ConversationUi | null>(null)

export function useConversationUi(): ConversationUi {
  const ui = useContext(ConversationUiContext)
  if (ui === null)
    throw new Error('No ConversationUiContext. Message rows need a ConversationScreen.')
  return ui
}
