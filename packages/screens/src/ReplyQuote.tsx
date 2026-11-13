import { requirePorts } from '@session/app'
import type { Message, Reply } from '@session/client'
import { useAccount, useConversation } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { MessageQuote } from '@session/ui'
import { useMemo } from 'react'

import { useConversationUi } from './conversationUi'
import { authorName, quotedOriginal, quoteLabels } from './quotedReply'
import { useLocale } from './useLocale'

/** The quote heading a reply's bubble: what it answers. */
export function ReplyQuote({ message, reply }: { message: Message; reply: Reply }) {
  const { conversationId } = useConversationUi()
  const conversation = useConversation(conversationId)
  const account = useAccount()
  // The labels are the catalogue's, read when this draws.
  useLocale()
  const quoted = useMemo(() => quotedOriginal(reply, requirePorts().media), [reply])
  return (
    <MessageQuote
      author={authorName(reply.author, account?.sessionId, conversation ?? { id: conversationId })}
      message={quoted}
      labels={quoteLabels()}
      onAccent={message.outgoing}
      testID={ELEMENT.conversation.messageQuote}
      thumbnailTestID={ELEMENT.conversation.messageQuoteThumbnail}
    />
  )
}
