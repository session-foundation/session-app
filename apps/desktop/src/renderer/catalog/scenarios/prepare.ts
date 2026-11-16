import { requirePorts } from '@session/app'
import { isDisplayableImage } from '@session/basic-types'
import type { ConversationId, Message } from '@session/client'
import { transferKey, type SessionStore } from '@session/state'

/** A running transfer, as a file reports it, in encrypted bytes. */
interface Running {
  doneBytes: number
  totalBytes: number
}

/**
 * What a few rows' messages are put through before any page draws, by body. Each is its own
 * message, never one another page draws at rest: the store is shared by every page.
 */
const PREPARE: Record<string, 'downloaded' | 'downloadFailed' | Running> = {
  'Two, one above the other': 'downloaded',
  'Four in two rows': { doneBytes: 50, totalBytes: 100 },
  'Five: two above three': 'downloadFailed',
  // The first report of every transfer, before a byte is here.
  'A pair for the ring at 0 of 0': { doneBytes: 0, totalBytes: 0 },
  'A pair for the ring at 40%': { doneBytes: 40, totalBytes: 100 },
  'A pair for the ring at 95%': { doneBytes: 95, totalBytes: 100 },
  'Ours from another device, for the ring at 0 of 0': { doneBytes: 0, totalBytes: 0 },
  'Ours from another device, for the ring at 40%': { doneBytes: 40, totalBytes: 100 },
  'Ours from another device, for the ring at 95%': { doneBytes: 95, totalBytes: 100 },
  'One file, caught downloading': { doneBytes: 40, totalBytes: 100 },
  'One picture as a list, caught downloading': { doneBytes: 40, totalBytes: 100 },
  // Quoted by a reply, which then draws libsession's thumbnail of it.
  'A view, downloaded': 'downloaded',
}

/** Four tenths of a 3 MB file, so a caption reads in the sizes a real one would. */
const UPLOAD_AT_40: Running = { doneBytes: 1_258_291, totalBytes: 3_145_728 }

/**
 * Ours, caught uploading: the upload each reports for its first file not up, which libsession
 * uploads one at a time in order. As `PREPARE`, never a message another page draws at rest.
 */
const UPLOADING: Record<string, Running> = {
  'Still uploading, one at a time': UPLOAD_AT_40,
  'One file, caught uploading': UPLOAD_AT_40,
  'The last of three uploading': UPLOAD_AT_40,
  'A pair, the second uploading': UPLOAD_AT_40,
}

/**
 * Ours, so its uploaded pictures are cached and thumbnailed, as a staged file's picture is. Its
 * thirty uploaded pictures take the fake's photo counter thirty times running, so they are every
 * dev photograph once, whatever the showcase draws before it.
 */
const PICTURES_FROM = 'File 31 of 32 failed'

const POLL_MS = 50

async function until(ready: () => boolean): Promise<void> {
  while (!ready()) await new Promise((resolve) => setTimeout(resolve, POLL_MS))
}

/**
 * The showcase's conversation, and its messages' ids by body: a reply with no words of its own by
 * `Reply to` and the body of the message it answers.
 */
export interface Scenario {
  conversationId: ConversationId
  messageIds: Map<string, number>
  /** Thumbnails of dev photographs that draw without a download, for files the catalog stages. */
  pictures: string[]
  /** Their senders' ThumbHashes, in the same order, for a story drawing a picture not yet here. */
  placeholders: string[]
}

export async function prepare(session: SessionStore): Promise<Scenario> {
  void session.actions.start()
  await until(() => session.getState().conversations.length > 0)
  const conversation = session.getState().conversations[0]
  if (conversation === undefined) throw new Error('the showcase has no conversation')
  const conversationId = conversation.id
  await session.actions.loadHistory(conversationId)
  while (session.getState().histories[conversationId]?.hasOlder === true)
    await session.actions.loadOlder(conversationId)

  const messages = session.getState().histories[conversationId]?.messages ?? []
  const byBody = (body: string): Message => {
    const found = messages.find((message) => message.body === body)
    if (found === undefined) throw new Error(`the showcase has no message "${body}"`)
    return found
  }

  for (const [body, preparation] of Object.entries(PREPARE)) {
    const message = byBody(body)
    if (preparation === 'downloaded') {
      for (const { index } of message.attachments)
        await session.actions.downloadAttachment({ messageId: message.id, index })
      await until(
        () =>
          (session.getState().histories[conversationId]?.messages ?? [])
            .find((candidate) => candidate.id === message.id)
            ?.attachments.every((attachment) => attachment.availability === 'cached') === true,
      )
      continue
    }
    session.setState((state) => ({
      transfers: {
        ...state.transfers,
        [message.id]: Object.fromEntries(
          message.attachments.map(({ index }) => [
            transferKey('download', index),
            preparation === 'downloadFailed'
              ? { state: 'failed' as const, doneBytes: 0, totalBytes: 100 }
              : { state: 'running' as const, ...preparation },
          ]),
        ),
      },
    }))
  }

  for (const [body, running] of Object.entries(UPLOADING)) {
    const message = byBody(body)
    const moving = message.attachments.find(({ uploaded }) => !uploaded)
    if (moving === undefined) throw new Error(`"${body}" has no file left to upload`)
    session.setState((state) => ({
      transfers: {
        ...state.transfers,
        [message.id]: { [transferKey('upload', moving.index)]: { state: 'running', ...running } },
      },
    }))
  }

  const { media } = requirePorts()
  const source = byBody(PICTURES_FROM)
  // In filename order rather than the message's: the fake names a picture for its photograph, and
  // the counter's starting photo moves whenever the showcase gains a picture above this message.
  const shown = source.attachments
    .filter(({ uploaded, contentType }) => uploaded && isDisplayableImage(contentType))
    .sort((a, b) => (a.filename ?? '').localeCompare(b.filename ?? ''))
  const urls = (
    attachments: typeof shown,
    urlFor: (ref: { messageId: number; index: number }) => string | null,
  ) =>
    attachments.flatMap(({ index }) => {
      const url = urlFor({ messageId: source.id, index })
      return url === null ? [] : [url]
    })
  const pictures = urls(shown, (ref) => media.thumbnailUrlFor(ref))
  const placeholders = urls(
    shown.filter(({ hasThumbhash }) => hasThumbhash),
    (ref) => media.thumbhashUrlFor(ref),
  )

  return {
    conversationId,
    messageIds: new Map(
      messages.map((message) => {
        const answered = message.replyTo
        const original =
          message.body === '' && answered !== undefined
            ? messages.find(
                (m) => m.author === answered.author && m.timestamp === answered.timestamp,
              )
            : undefined
        return [original === undefined ? message.body : `Reply to ${original.body}`, message.id]
      }),
    ),
    pictures,
    placeholders,
  }
}
