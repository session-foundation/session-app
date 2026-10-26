import { describe, expect, it } from 'vitest'

import { conversationRowState, unreadCountLabel } from '#src/conversationRowState'

const NOW = 1_700_000_000_000

type Fields = Parameters<typeof conversationRowState>[0]

const read: Fields = {
  kind: 'dm',
  noteToSelf: false,
  priority: 0,
  unreadCount: 0,
  markedUnread: false,
}

const row = (fields: Partial<Fields>) => conversationRowState({ ...read, ...fields }, NOW)

describe('a read row', () => {
  it('carries no strip, no badge and no emphasis', () => {
    expect(row({})).toEqual({
      kindGlyph: null,
      emphasised: false,
      pinned: false,
      muted: false,
      strip: null,
      badge: null,
    })
  })
})

describe('the kind glyph', () => {
  it('marks Note to Self, a group and a community, and nothing else', () => {
    expect(row({ noteToSelf: true }).kindGlyph).toBe('bookmark')
    expect(row({ kind: 'group' }).kindGlyph).toBe('usersRound')
    expect(row({ kind: 'community' }).kindGlyph).toBe('globe')
    expect(row({ kind: 'dm' }).kindGlyph).toBeNull()
  })
})

describe('pinned and muted', () => {
  it('pins on any priority above zero', () => {
    expect(row({ priority: 1 }).pinned).toBe(true)
    expect(row({ priority: 0 }).pinned).toBe(false)
    // Negative priority is how libsession hides a conversation; it is not a pin.
    expect(row({ priority: -1 }).pinned).toBe(false)
  })

  it('is muted only while the mute runs', () => {
    expect(row({ muteUntil: NOW + 1 }).muted).toBe(true)
    expect(row({ muteUntil: NOW }).muted).toBe(false)
    expect(row({ muteUntil: NOW - 1 }).muted).toBe(false)
    expect(row({}).muted).toBe(false)
  })
})

describe('an unread row', () => {
  it('is loud when it would alert', () => {
    expect(row({ unreadCount: 3 })).toMatchObject({
      emphasised: true,
      strip: 'notify',
      badge: { kind: 'count', label: '3', tone: 'notify' },
    })
  })

  it('is quiet, but still counted and emphasised, while muted', () => {
    expect(row({ unreadCount: 48, muteUntil: NOW + 60_000 })).toMatchObject({
      emphasised: true,
      muted: true,
      strip: 'quiet',
      badge: { kind: 'count', label: '48', tone: 'quiet' },
    })
  })

  it('is loud again once a mute lapses', () => {
    expect(row({ unreadCount: 2, muteUntil: NOW - 1 }).strip).toBe('notify')
  })
})

describe('a row marked unread', () => {
  it('shows the envelope with the accent strip', () => {
    expect(row({ markedUnread: true })).toMatchObject({
      emphasised: true,
      strip: 'notify',
      badge: { kind: 'markedUnread' },
    })
  })

  it('replaces the count rather than sitting beside it', () => {
    expect(row({ markedUnread: true, unreadCount: 5 }).badge).toEqual({ kind: 'markedUnread' })
  })

  it('stays loud through a mute, because the reader asked for the reminder', () => {
    expect(row({ markedUnread: true, unreadCount: 5, muteUntil: NOW + 1 }).strip).toBe('notify')
  })
})

describe('the count', () => {
  it('is the number up to 9999, and says "9999+" past it', () => {
    expect(unreadCountLabel(1)).toBe('1')
    expect(unreadCountLabel(9999)).toBe('9999')
    expect(unreadCountLabel(10_000)).toBe('9999+')
    expect(unreadCountLabel(12_000)).toBe('9999+')
  })
})
