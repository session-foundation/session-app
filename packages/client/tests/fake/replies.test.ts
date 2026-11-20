import { describe, expect, it } from 'vitest'

import { REPLIES, replies } from '#src/fake/replies'

/** What the `replies` fixture promises whoever drives an app on it. */
async function seeded(options?: { nearEnd: boolean }) {
  const { world, clients } = replies(options)
  const alice = clients['Alice']
  if (!alice) throw new Error('fixture did not produce a client')
  const bob = world.account('Bob').sessionId
  const { messages } = await alice.getMessages(bob, { limit: 500 })
  const saying = (body: string) => {
    const found = messages.find((m) => m.body === body)
    if (!found) throw new Error(`nothing says "${body}"`)
    return found
  }
  return { alice, bob, messages, saying, own: world.account('Alice').sessionId }
}

describe('the replies fixture', () => {
  it('chains two replies, each more than a jump’s window from what it answers', async () => {
    const { messages, saying } = await seeded()
    const at = (body: string) => messages.indexOf(saying(body))

    expect(saying(REPLIES.seeYou).replyTo?.message?.body).toBe(REPLIES.station)
    expect(saying(REPLIES.station).replyTo?.message?.body).toBe(REPLIES.meet)
    expect(saying(REPLIES.meet).replyTo).toBeUndefined()
    expect(at(REPLIES.meet)).toBe(0)
    expect(at(REPLIES.station) - at(REPLIES.meet)).toBeGreaterThan(60)
    expect(at(REPLIES.seeYou) - at(REPLIES.station)).toBeGreaterThan(60)
  })

  it('opens on a page holding every reply but the chain’s middle', async () => {
    const { alice, bob } = await seeded()
    const newest = (await alice.getMessages(bob, { limit: 30 })).messages.map((m) => m.body)
    expect(newest.at(-1)).toBe(REPLIES.newest)
    for (const body of [
      REPLIES.whereIsThis,
      REPLIES.seeYou,
      REPLIES.neverReceived,
      REPLIES.deletedSince,
    ])
      expect(newest, body).toContain(body)
    expect(newest).not.toContain(REPLIES.station)
  })

  it('answers, next to the newest, a message on the page it opens on, near its end alone', async () => {
    const { alice, bob, saying } = await seeded({ nearEnd: true })
    const newest = (await alice.getMessages(bob, { limit: 30 })).messages.map((m) => m.body)
    expect(saying(REPLIES.homeNow).replyTo?.message?.body).toBe(REPLIES.homeAsk)
    expect(newest).toContain(REPLIES.homeAsk)
    expect(newest.at(-2)).toBe(REPLIES.homeNow)

    const { messages } = await seeded()
    expect(messages.map((m) => m.body)).not.toContain(REPLIES.homeNow)
  })

  it('answers a picture with the sender’s ThumbHash, not downloaded', async () => {
    const { saying } = await seeded()
    const [picture] = saying(REPLIES.whereIsThis).replyTo?.message?.attachments ?? []
    expect(picture?.hasThumbhash).toBe(true)
    expect(picture?.hasThumbnail).toBe(false)
  })

  it('answers one message never received, and one deleted since', async () => {
    const { saying, own } = await seeded()
    expect(saying(REPLIES.neverReceived).replyTo).toEqual({ author: own, timestamp: 1 })
    const deleted = saying(REPLIES.deletedSince).replyTo
    expect(deleted?.messageId).toBeDefined()
    expect(deleted?.message?.deleted).toBe('here')
  })
})
