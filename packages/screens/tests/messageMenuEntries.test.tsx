import type { Attachment, Message } from '@session/client'
import { ELEMENT } from '@session/test-ids'
import type { ContextMenuEntry } from '@session/ui'
import { describe, expect, it, vi } from 'vitest'

import { messageMenuEntries } from '#src/messageMenuEntries'

const ITEM = ELEMENT.contextMenu.item
const STANDARD = `05${'a'.repeat(64)}`

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 7,
    author: STANDARD,
    body: 'Hello',
    outgoing: false,
    sendState: 'sent',
    attachments: [],
    ...overrides,
  } as unknown as Message
}

const file = (index: number, availability: Attachment['availability']): Attachment =>
  ({ index, availability }) as unknown as Attachment

function actions() {
  return {
    reply: vi.fn(),
    retry: vi.fn(),
    exportAttachment: vi.fn(),
    copyBody: vi.fn(),
    copyAuthor: vi.fn(),
  }
}

/** Each row as `id` or `id (disabled)`, separators as `|`. */
function shape(entries: readonly ContextMenuEntry[]): string[] {
  return entries.map((entry) =>
    entry.kind === 'separator' ? '|' : `${entry.id}${entry.disabled === true ? ' (disabled)' : ''}`,
  )
}

const choose = (entries: readonly ContextMenuEntry[], id: string) => {
  const entry = entries.find((candidate) => candidate.id === id)
  if (entry?.kind !== 'action') throw new Error(`no action ${id}`)
  entry.onSelect()
}

describe('a message’s context menu', () => {
  it('offers on a received text what can be done, and greys what is not built', () => {
    expect(shape(messageMenuEntries(message(), actions()))).toEqual([
      'reply',
      'copy',
      'info (disabled)',
      'select (disabled)',
      'copyAccountId',
      '|',
      'delete (disabled)',
    ])
  })

  it('starts a reply from Reply', () => {
    const chosen = actions()
    choose(messageMenuEntries(message(), chosen), 'reply')
    expect(chosen.reply).toHaveBeenCalledOnce()
  })

  it('greys Reply on a message that cannot be answered: ours until sent, and a deleted one', () => {
    const replyOf = (overrides: Partial<Message>) =>
      shape(messageMenuEntries(message(overrides), actions())).find((row) =>
        row.startsWith('reply'),
      )
    expect(replyOf({ outgoing: true, sendState: 'sent' })).toBe('reply')
    for (const sendState of ['pending', 'sending', 'uploading', 'failed', 'unsendable'] as const)
      expect(replyOf({ outgoing: true, sendState })).toBe('reply (disabled)')
    expect(replyOf({ deleted: 'here' })).toBe('reply (disabled)')
  })

  it('offers Resend on a failed send of ours, and no Copy Account ID', () => {
    const entries = messageMenuEntries(message({ outgoing: true, sendState: 'failed' }), actions())
    expect(shape(entries)[0]).toBe('retry')
    expect(shape(entries)).not.toContain('copyAccountId')
  })

  it('offers no Copy Account ID for a blinded author', () => {
    for (const prefix of ['15', '25'])
      expect(
        shape(messageMenuEntries(message({ author: `${prefix}${'a'.repeat(64)}` }), actions())),
      ).not.toContain('copyAccountId')
  })

  it('leaves Copy off a message with no text', () => {
    const entries = messageMenuEntries(
      message({ body: '', attachments: [file(0, 'cached')] }),
      actions(),
    )
    expect(shape(entries)).not.toContain('copy')
  })

  it('writes out a lone file that is here, and greys Save for one that is not or for a set', () => {
    const here = actions()
    choose(messageMenuEntries(message({ attachments: [file(3, 'cached')] }), here), 'export')
    expect(here.exportAttachment).toHaveBeenCalledWith(3)
    expect(
      shape(messageMenuEntries(message({ attachments: [file(0, 'absent')] }), actions())),
    ).toContain('export (disabled)')
    expect(
      shape(
        messageMenuEntries(
          message({ attachments: [file(0, 'cached'), file(1, 'cached')] }),
          actions(),
        ),
      ),
    ).toContain('export (disabled)')
  })

  it('copies the body and the author', () => {
    const on = actions()
    const entries = messageMenuEntries(message(), on)
    choose(entries, 'copy')
    choose(entries, 'copyAccountId')
    expect(on.copyBody).toHaveBeenCalledOnce()
    expect(on.copyAuthor).toHaveBeenCalledOnce()
  })

  it('addresses every row by its registered id', () => {
    for (const entry of messageMenuEntries(message(), actions()))
      if (entry.kind !== 'separator') expect(entry.testID).toBe(ITEM(entry.id))
  })
})
