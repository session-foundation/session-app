import type { Frame } from '@session/client'
import { describe, expect, it } from 'vitest'

import { routeFrames } from '#src/main/frameRouter'

import { owed, stubBridge } from './stubBridge'

const empty = { result: { type: 'empty' } } as const

describe('the bridge’s frames', () => {
  it('reach the window in the order they came, those from before it attached first', () => {
    const bridge = stubBridge({ early: [owed(1), owed(2)] })
    const frames = routeFrames(bridge)
    bridge.emit(owed(3))

    const seen: Frame[] = []
    frames.attach((frame) => seen.push(frame))
    bridge.emit(owed(4))

    expect(seen).toEqual([owed(1), owed(2), owed(3), owed(4)])
  })

  it('answer main’s own requests and never the window', async () => {
    const bridge = stubBridge({ respond: () => empty })
    const frames = routeFrames(bridge)
    const seen: Frame[] = []
    frames.attach((frame) => seen.push(frame))

    await expect(frames.request({ type: 'getAccountInfo' })).resolves.toMatchObject(empty)
    expect(seen).toEqual([])
  })

  it('keep a late answer to main from the window', () => {
    const bridge = stubBridge()
    const frames = routeFrames(bridge)
    void frames.request({ type: 'getAccountInfo' })
    const seen: Frame[] = []
    frames.attach((frame) => seen.push(frame))

    const [request] = bridge.sent
    if (request === undefined) throw new Error('nothing was sent')
    bridge.answer(request.id, empty)

    expect(seen).toEqual([])
  })

  it('carry main’s requests on ids a window’s client never uses', () => {
    const bridge = stubBridge()
    const frames = routeFrames(bridge)
    void frames.request({ type: 'getAccountInfo' })
    void frames.request({ type: 'getAccountInfo' })
    expect(bridge.sent.map((request) => request.id)).toEqual([-1, -2])
  })
})
