import { ELEMENT } from '@session/test-ids'
import { YStack } from 'tamagui'

import { MessageFrame } from '../../MessageFrame'
import { MessageQuote } from '../../MessageQuote'
import type { QuotedAttachment, QuotedMessage, QuoteLabels } from '../../quotePreview'
import { Text } from '../../Text'
import { useCatalogPicture, useCatalogPlaceholder } from '../pictures'
import { defineStory } from '../story'
import { noop } from './shared'

export const QUOTE_LABELS: QuoteLabels = {
  image: 'Image',
  gif: 'GIF',
  video: 'Video',
  audio: 'Audio',
  voice: 'Voice Message',
  file: 'Document',
  andMore: (count) => `+${String(count)}`,
  notFound: 'Original message not found',
}

/** Which of the catalog's photographs an attachment draws, as its thumbnail or its ThumbHash. */
type CatalogAttachment = Omit<QuotedAttachment, 'uri' | 'thumbhash'> & {
  picture?: number | undefined
  placeholder?: number | undefined
}

export interface QuoteRow {
  author: string
  /** Absent: the original was deleted or never received. */
  quoted?:
    | (Omit<QuotedMessage, 'id' | 'outgoing' | 'attachments'> & {
        attachments?: readonly CatalogAttachment[] | undefined
      })
    | undefined
  reply: string
  busy?: boolean | undefined
}

const JPEG = { contentType: 'image/jpeg', voiceMessage: false } as const

function useQuoted(row: QuoteRow): QuotedMessage | undefined {
  const attachments = row.quoted?.attachments ?? []
  // A story draws at most two pictures per quote, so the hooks are called a fixed number of times.
  const pictures = [
    useCatalogPicture(attachments[0]?.picture),
    useCatalogPicture(attachments[1]?.picture),
  ]
  const placeholders = [
    useCatalogPlaceholder(attachments[0]?.placeholder),
    useCatalogPlaceholder(attachments[1]?.placeholder),
  ]
  if (row.quoted === undefined) return undefined
  return {
    id: 1,
    outgoing: false,
    body: row.quoted.body,
    deleted: row.quoted.deleted,
    attachments: attachments.map(
      ({ picture: _picture, placeholder: _placeholder, ...rest }, at) => ({
        ...rest,
        uri: pictures[at],
        thumbhash: placeholders[at],
      }),
    ),
  }
}

function Bubble({ row, outgoing }: { row: QuoteRow; outgoing: boolean }) {
  const message = useQuoted(row)
  return (
    <MessageFrame
      outgoing={outgoing}
      alignSelf={outgoing ? 'flex-end' : 'flex-start'}
      maxWidth="90%"
    >
      <MessageQuote
        author={row.author}
        message={message}
        labels={QUOTE_LABELS}
        onAccent={outgoing}
        onPress={noop}
        hint="Shows the original message"
        busy={row.busy}
        testID={ELEMENT.conversation.messageQuote}
        thumbnailTestID={ELEMENT.conversation.messageQuoteThumbnail}
      />
      <Text size="$body" color={outgoing ? '$onAccent' : '$messageBubbleIncomingText'}>
        {row.reply}
      </Text>
    </MessageFrame>
  )
}

/** The same quote in a bubble they sent and in one we sent, which draw it in different inks. */
function Pair(row: QuoteRow) {
  return (
    <YStack gap="$sm">
      <Bubble row={row} outgoing={false} />
      <Bubble row={row} outgoing />
    </YStack>
  )
}

const LONG_BODY =
  'I looked at the three flats on Saturday. The one near the station is the best value but the ' +
  'kitchen is tiny and the landlord wants six months up front, which'

export const messageQuote = defineStory<QuoteRow>({
  component: 'messageQuote',
  story: 'text',
  width: 340,
  forced: ['hover', 'focus'],
  sensitive: { accent: true, rtl: true },
  variants: {
    text: { author: 'Bob', quoted: { body: 'Are we still on for Thursday?' }, reply: 'Yes, 7pm' },
    longText: { author: 'You', quoted: { body: LONG_BODY }, reply: 'Skip that one' },
    replyToReply: { author: 'Bob', quoted: { body: 'Skip that one' }, reply: 'Agreed' },
    busy: {
      author: 'Bob',
      quoted: { body: 'Are we still on for Thursday?' },
      reply: 'Yes, 7pm',
      busy: true,
    },
    lineBreaks: {
      author: 'Bob',
      quoted: { body: 'Hey\n this is audric\n\nhow are you?' },
      reply: 'Hi!',
    },
    notFound: { author: 'Bob', reply: 'What did it say?' },
  },
  render: (row) => <Pair {...row} />,
})

export const messageQuotePictures = defineStory<QuoteRow>({
  component: 'messageQuote',
  story: 'pictures',
  width: 340,
  pictures: true,
  forced: ['hover', 'focus'],
  sensitive: { rtl: true },
  variants: {
    picture: {
      author: 'You',
      quoted: { body: '', attachments: [{ ...JPEG, picture: 0 }] },
      reply: 'Where is this?',
    },
    album: {
      author: 'Bob',
      quoted: {
        body: 'Beach day',
        attachments: [
          { ...JPEG, picture: 1 },
          { ...JPEG, picture: 2 },
          { ...JPEG },
          { ...JPEG },
          { ...JPEG },
        ],
      },
      reply: 'Send me the third one',
    },
    notDownloaded: {
      author: 'Bob',
      quoted: { body: '', attachments: [{ ...JPEG, placeholder: 0 }] },
      reply: 'Nice',
    },
    noThumbhash: { author: 'Bob', quoted: { body: '', attachments: [{ ...JPEG }] }, reply: 'Nice' },
    gif: {
      author: 'Bob',
      quoted: {
        body: '',
        attachments: [{ contentType: 'image/gif', voiceMessage: false, picture: 3 }],
      },
      reply: 'lol',
    },
    video: {
      author: 'Bob',
      quoted: { body: '', attachments: [{ contentType: 'video/mp4', voiceMessage: false }] },
      reply: 'Watching now',
    },
    mixed: {
      author: 'Bob',
      quoted: {
        body: 'The view from the top, totally worth the climb',
        attachments: [{ ...JPEG, picture: 2 }],
      },
      reply: 'Jealous',
    },
    attachmentGone: {
      author: 'Bob',
      quoted: { body: '', attachments: [{ ...JPEG, unavailable: true }] },
      reply: 'Can you resend?',
    },
  },
  render: (row) => <Pair {...row} />,
})

export const messageQuoteFiles = defineStory<QuoteRow>({
  component: 'messageQuote',
  story: 'files',
  width: 340,
  forced: ['hover', 'focus'],
  sensitive: { rtl: true },
  variants: {
    voice: {
      author: 'You',
      quoted: { body: '', attachments: [{ contentType: 'audio/aac', voiceMessage: true }] },
      reply: "Can't listen now",
    },
    audio: {
      author: 'Bob',
      quoted: {
        body: '',
        attachments: [
          { contentType: 'audio/mp4', voiceMessage: false, filename: 'interview-take-3.m4a' },
        ],
      },
      reply: 'Thanks',
    },
    file: {
      author: 'Bob',
      quoted: {
        body: '',
        attachments: [
          {
            contentType: 'application/pdf',
            voiceMessage: false,
            filename: 'Lease agreement 2026 signed by both parties final.pdf',
          },
        ],
      },
      reply: 'Signed',
    },
    files: {
      author: 'Bob',
      quoted: {
        body: '',
        attachments: [
          { contentType: 'application/pdf', voiceMessage: false, filename: 'invoice-march.pdf' },
          { contentType: 'application/pdf', voiceMessage: false, filename: 'invoice-april.pdf' },
          { contentType: 'application/pdf', voiceMessage: false, filename: 'invoice-may.pdf' },
        ],
      },
      reply: 'Paid all three',
    },
    unnamedFile: {
      author: 'Bob',
      quoted: { body: '', attachments: [{ contentType: 'application/pdf', voiceMessage: false }] },
      reply: 'What is it?',
    },
  },
  render: (row) => <Pair {...row} />,
})

export const messageQuoteAuthors = defineStory<QuoteRow>({
  component: 'messageQuote',
  story: 'authors',
  width: 340,
  forced: [],
  sensitive: { rtl: true },
  variants: {
    you: { author: 'You', quoted: { body: 'Running 10 minutes late' }, reply: 'No worries' },
    noteToSelf: {
      author: 'You',
      quoted: { body: 'Buy milk, call the bank' },
      reply: 'Done the bank',
    },
    longAuthor: {
      author: 'Maximilian-Alexander von Hohenzollern-Sigmaringen',
      quoted: { body: 'Ok' },
      reply: 'Ok to what?',
    },
    arabic: { author: 'أنت', quoted: { body: 'هل وصلت الطرود اليوم؟' }, reply: 'نعم، شكراً' },
  },
  render: (row) => <Pair {...row} />,
})
