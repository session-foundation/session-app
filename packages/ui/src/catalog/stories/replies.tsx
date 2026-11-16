import { ALBUM_WIDTH } from '@session/basic-types'
import { ELEMENT } from '@session/test-ids'

import { AttachmentAlbum } from '../../AttachmentAlbum'
import { FileRow } from '../../FileRow'
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
  body?: string | undefined
  /** How many of the catalog's photographs the reply itself carries, as an album. */
  album?: number | undefined
  /** A document the reply itself carries. */
  file?: string | undefined
}

const LONG =
  'Yes, but only if we can leave before six. The traffic on the ring road is terrible on a ' +
  'Thursday and I would rather not spend the evening in it. I can drive if you want.'

function Album({ count, onAccent }: { count: number; onAccent: boolean }) {
  const pictures = [useCatalogPicture(4), useCatalogPicture(5), useCatalogPicture(6)]
  return (
    <AttachmentAlbum
      items={pictures.slice(0, count).map((uri, at) => ({
        uri,
        label: `${String(at + 1)}.jpg`,
        hint: 'Open',
      }))}
      width={ALBUM_WIDTH}
      overflowLabel={(more) => `+${String(more)}`}
      overflowName={(label, more) => `${label} and ${String(more)} more`}
      onOpen={noop}
      fetchLabel="Download"
      fetchTestID={ELEMENT.conversation.attachmentFetch}
      tileTestID={ELEMENT.conversation.attachmentTile}
      onAccent={onAccent}
      testID={ELEMENT.conversation.attachment}
    />
  )
}

/**
 * A whole reply as the transcript draws one: the quote heading the bubble, then the reply's own
 * text and attachments, in the order `MessageRow` draws them.
 */
function Reply({ outgoing, author, quoted, quotedPicture, body, album, file }: ReplyRow) {
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
      maxWidth={album === undefined && file === undefined ? '80%' : '100%'}
    >
      <MessageQuote
        author={author}
        message={message}
        labels={QUOTE_LABELS}
        onAccent={outgoing}
        onPress={noop}
        testID={ELEMENT.conversation.messageQuote}
      />
      {body === undefined ? null : (
        <Text
          size="$body"
          color={ink}
          {...(album === undefined && file === undefined ? {} : { maxWidth: ALBUM_WIDTH })}
        >
          {body}
        </Text>
      )}
      {album === undefined ? null : <Album count={album} onAccent={outgoing} />}
      {file === undefined ? null : (
        <FileRow
          filename={file}
          contentType="application/pdf"
          caption="180 kB"
          state="ready"
          actionLabel="Export"
          onAction={noop}
          onAccent={outgoing}
        />
      )}
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
    album: { outgoing: true, author: 'Bob', quoted: 'Send them', body: 'Here', album: 3 },
    albumNoText: { outgoing: true, author: 'Bob', quoted: 'Pics?', album: 2 },
    file: {
      outgoing: true,
      author: 'Bob',
      quoted: 'The lease?',
      body: 'Signed',
      file: 'lease.pdf',
    },
    theirsLongBody: { outgoing: false, author: 'You', quoted: 'Thursday?', body: LONG },
    theirsToPicture: {
      outgoing: false,
      author: 'You',
      quoted: '',
      quotedPicture: 0,
      body: 'Where is this?',
    },
    theirsAlbum: { outgoing: false, author: 'You', quoted: 'Any photos?', album: 3 },
  },
  render: (row) => <Reply {...row} />,
})
