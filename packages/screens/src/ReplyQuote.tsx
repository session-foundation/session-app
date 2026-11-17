import { requirePorts } from '@session/app'
import type { Message, Reply } from '@session/client'
import { PENDING_COPY } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { MessageQuote } from '@session/ui'
import { useContext, useMemo } from 'react'

import { QuoteJumpContext, useConversationUi } from './conversationUi'
import { quotedOriginal, quoteLabels } from './quotedReply'
import { useLocale } from './useLocale'

/** The quote heading a reply's bubble: what it answers, and the way to it. */
export function ReplyQuote({ message, reply }: { message: Message; reply: Reply }) {
  const { nameOf, openQuote } = useConversationUi()
  // The labels are the catalogue's, read when this draws.
  useLocale()
  const busy = useContext(QuoteJumpContext) === message.id
  const quoted = useMemo(() => quotedOriginal(reply, requirePorts().media), [reply])
  return (
    <MessageQuote
      author={nameOf(reply.author)}
      message={quoted}
      labels={quoteLabels()}
      onAccent={message.outgoing}
      onPress={() => {
        openQuote(message.id)
      }}
      hint={PENDING_COPY.messageQuoteHint}
      busy={busy}
      testID={ELEMENT.conversation.messageQuote}
      thumbnailTestID={ELEMENT.conversation.messageQuoteThumbnail}
    />
  )
}
