import type { ConversationId } from '@session/client'
import { createContext, useContext } from 'react'

import type { ViewChoices } from './viewChoices'

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
  /** The shape the reader chose for each message's attachments, where they chose one. */
  views: ViewChoices
  /** `index` is the attachment's index in the message, not its place among the viewable ones. */
  openViewer: (messageId: number, index: number) => void
  openSheet: (messageId: number) => void
}

export const ConversationUiContext = createContext<ConversationUi | null>(null)

export function useConversationUi(): ConversationUi {
  const ui = useContext(ConversationUiContext)
  if (ui === null)
    throw new Error('No ConversationUiContext. Message rows need a ConversationScreen.')
  return ui
}
