import type { Attachment, Message, Reply } from '@session/client'
import { tr } from '@session/localization'
import { describe, expect, it } from 'vitest'

import {
  authorName,
  canReply,
  originalFound,
  quotedMessage,
  quotedOriginal,
  quoteLabels,
  replyingToHeading,
} from '#src/quotedReply'

const OWN = `05${'a'.repeat(64)}`
const BOB = `05${'b'.repeat(60)}cafe`
const CAROL = `05${'c'.repeat(60)}beef`

const media = {
  thumbnailUrlFor: ({ messageId, index }: { messageId: number; index: number }) =>
    `thumbnail:${String(messageId)}/${String(index)}`,
  thumbhashUrlFor: ({ messageId, index }: { messageId: number; index: number }) =>
    `thumbhash:${String(messageId)}/${String(index)}`,
}

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    index: 0,
    contentType: 'image/jpeg',
    voiceMessage: false,
    hasThumbhash: false,
    hasThumbnail: false,
    thumbnailWidthPx: 0,
    thumbnailHeightPx: 0,
    hasRendition: false,
    renditionRefused: false,
    originalFile: false,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
    ...overrides,
  }
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 7,
    conversationId: BOB,
    author: BOB,
    timestamp: 1000,
    body: 'Hello',
    outgoing: false,
    sendState: 'sent',
    attachments: [],
    galleryViewable: false,
    gallery: false,
    ...overrides,
  }
}

describe('who a quote says wrote the original', () => {
  const bob = { id: BOB, displayName: 'Bob' }

  it('says You for this account, in a note to self as anywhere', () => {
    expect(authorName(OWN, OWN, bob)).toBe(tr('you'))
    expect(authorName(OWN, OWN, { id: OWN, displayName: 'Alice' })).toBe(tr('you'))
  })

  it('names the other side of the conversation as the conversation is named', () => {
    expect(authorName(BOB, OWN, bob)).toBe('Bob')
    expect(authorName(BOB, OWN, { ...bob, nickname: 'Bobby' })).toBe('Bobby')
    expect(authorName(BOB, OWN, { id: BOB, displayName: '' })).toBe('(05bb...cafe)')
  })

  it('shortens the id of anyone else, whatever the conversation is called', () => {
    expect(authorName(CAROL, OWN, { ...bob, nickname: 'Bobby' })).toBe('(05cc...beef)')
  })

  it('does not take another account for this one before the account is known', () => {
    expect(authorName(BOB, undefined, bob)).toBe('Bob')
  })

  it('heads the composer bar with the author kept apart from the words before it', () => {
    expect(replyingToHeading('Bob!')).toBe(`${tr('messageReplyingTo')} ⁨Bob!⁩`)
  })
})

describe('a quote’s labels', () => {
  it('are the catalogue’s, the count of the rest included', () => {
    const labels = quoteLabels()
    expect(labels).toMatchObject({
      image: tr('image'),
      gif: tr('gif'),
      video: tr('video'),
      audio: tr('audio'),
      voice: tr('messageVoice'),
      file: tr('document'),
      notFound: tr('messageErrorOriginal'),
    })
    expect(labels.andMore(4)).toBe(tr('andMore', { count: 4 }))
  })
})

describe('the original as a quote draws it', () => {
  const reply = (original?: Reply['message']): Reply => ({
    author: BOB,
    timestamp: 1000,
    ...(original === undefined ? {} : { messageId: original.id, message: original }),
  })

  it('is absent for an original this device never received', () => {
    expect(quotedOriginal(reply(), media)).toBeUndefined()
    expect(originalFound(reply())).toBe(false)
  })

  it('carries the body and who sent it', () => {
    const original = { id: 3, outgoing: true, body: 'Running late', attachments: [] }
    expect(quotedOriginal(reply(original), media)).toEqual({
      id: 3,
      outgoing: true,
      body: 'Running late',
      attachments: [],
      deleted: false,
    })
    expect(originalFound(reply(original))).toBe(true)
  })

  it('marks a deleted original, which is then not there to jump to', () => {
    const original = {
      id: 3,
      outgoing: false,
      body: '',
      attachments: [],
      deleted: 'everywhere' as const,
    }
    expect(quotedOriginal(reply(original), media)?.deleted).toBe(true)
    expect(originalFound(reply(original))).toBe(false)
  })

  it('draws a picture from libsession’s thumbnail once there is one, else the ThumbHash', () => {
    const pictures = (first: Partial<Attachment>) =>
      quotedMessage(
        message({ id: 9, attachments: [attachment(first), attachment({ index: 1 })] }),
        media,
      ).attachments

    expect(pictures({ hasThumbhash: true })[0]).toMatchObject({
      uri: undefined,
      thumbhash: 'thumbhash:9/0',
    })
    expect(pictures({ hasThumbhash: true, hasThumbnail: true })[0]).toMatchObject({
      uri: 'thumbnail:9/0',
      thumbhash: 'thumbhash:9/0',
    })
    // Neither: the flat tile.
    expect(pictures({})[1]).toMatchObject({ uri: undefined, thumbhash: undefined })
  })

  it('keeps what names a file: its type, its name and whether it is a voice message', () => {
    const [file] = quotedMessage(
      message({
        attachments: [
          attachment({ contentType: 'audio/aac', filename: 'take-3.aac', voiceMessage: true }),
        ],
      }),
      media,
    ).attachments
    expect(file).toMatchObject({
      contentType: 'audio/aac',
      filename: 'take-3.aac',
      voiceMessage: true,
    })
  })

  it('says a file is gone when the server no longer has it or it cannot be read', () => {
    const unavailable = (availability: Attachment['availability']) =>
      quotedMessage(message({ attachments: [attachment({ availability })] }), media).attachments[0]
        ?.unavailable
    expect(unavailable('notFound')).toBe(true)
    expect(unavailable('unreadable')).toBe(true)
    expect(unavailable('absent')).toBe(false)
    expect(unavailable('cached')).toBe(false)
  })
})

describe('which messages can be answered', () => {
  it('takes any message received', () => {
    expect(canReply(message())).toBe(true)
  })

  it('takes ours only once sent: the other side has to hold what a reply names', () => {
    expect(canReply(message({ outgoing: true, sendState: 'sent' }))).toBe(true)
    for (const sendState of [
      'pending',
      'sending',
      'uploading',
      'failed',
      'interrupted',
      'unsendable',
    ] as const)
      expect(canReply(message({ outgoing: true, sendState })), sendState).toBe(false)
  })

  it('takes no deleted message', () => {
    expect(canReply(message({ deleted: 'here' }))).toBe(false)
    expect(canReply(message({ outgoing: true, deleted: 'everywhere' }))).toBe(false)
  })
})
