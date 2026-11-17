import { requirePorts } from '@session/app'
import type { Message, Reply } from '@session/client'
import { ELEMENT } from '@session/test-ids'
import { MessageQuote } from '@session/ui'
import { useMemo } from 'react'

import { useConversationUi } from './conversationUi'
import { quotedOriginal, quoteLabels } from './quotedReply'
import { useLocale } from './useLocale'

/** The quote heading a reply's bubble: what it answers. */
export function ReplyQuote({ message, reply }: { message: Message; reply: Reply }) {
  const { nameOf } = useConversationUi()
  // The labels are the catalogue's, read when this draws.
  useLocale()
  const quoted = useMemo(() => quotedOriginal(reply, requirePorts().media), [reply])
  return (
    <MessageQuote
      author={nameOf(reply.author)}
      message={quoted}
      labels={quoteLabels()}
      onAccent={message.outgoing}
      testID={ELEMENT.conversation.messageQuote}
      thumbnailTestID={ELEMENT.conversation.messageQuoteThumbnail}
    />
  )
}
