import { ELEMENT } from '@session/test-ids'

import { MessageFrame } from '../../MessageFrame'
import { MessageQuote } from '../../MessageQuote'
import type { QuotedMessage } from '../../quotePreview'
import { Text } from '../../Text'
import { useCatalogPicture } from '../pictures'
import { defineStory } from '../story'
import { QUOTE_LABELS } from '../quoteLabels'
import { noop } from './shared'

interface ReplyRow {
  /** Ours, on the accent; otherwise theirs. */
  outgoing: boolean
  author: string
  quoted: string
  /** Which catalog photograph the quoted message carries, if any. */
  quotedPicture?: number | undefined
  body: string
}

const LONG =
  'Yes, but only if we can leave before six. The traffic on the ring road is terrible on a ' +
  'Thursday and I would rather not spend the evening in it. I can drive if you want.'

/**
 * A reply's bubble as the transcript draws one with text only: the quote heading it, then the
 * reply's words. One carrying attachments is the screens' to draw, with their footer.
 */
function Reply({ outgoing, author, quoted, quotedPicture, body }: ReplyRow) {
  const uri = useCatalogPicture(quotedPicture)
  const message: QuotedMessage = {
    id: 1,
    outgoing: !outgoing,
    body: quoted,
    attachments:
      quotedPicture === undefined ? [] : [{ contentType: 'image/jpeg', voiceMessage: false, uri }],
  }
  const ink = outgoing ? '$onAccent' : '$messageBubbleIncomingText'
  return (
    <MessageFrame
      outgoing={outgoing}
      alignSelf={outgoing ? 'flex-end' : 'flex-start'}
      maxWidth="80%"
    >
      <MessageQuote
        author={author}
        message={message}
        labels={QUOTE_LABELS}
        onAccent={outgoing}
        onPress={noop}
        testID={ELEMENT.conversation.messageQuote}
      />
      <Text size="$body" color={ink}>
        {body}
      </Text>
    </MessageFrame>
  )
}

export const messageQuoteReplies = defineStory<ReplyRow>({
  component: 'messageQuote',
  story: 'replies',
  width: 360,
  pictures: true,
  sensitive: { rtl: true },
  variants: {
    longBody: { outgoing: true, author: 'Bob', quoted: 'Thursday?', body: LONG },
    shortBody: { outgoing: true, author: 'Bob', quoted: 'Ready?', body: 'Yes' },
    theirsLongBody: { outgoing: false, author: 'You', quoted: 'Thursday?', body: LONG },
    theirsToPicture: {
      outgoing: false,
      author: 'You',
      quoted: '',
      quotedPicture: 0,
      body: 'Where is this?',
    },
  },
  render: (row) => <Reply {...row} />,
})
