import type { Frame, Request } from '@session/client'
import { describe, expect, it } from 'vitest'

import { shareBridge } from '#src/main/shareBridge'

import { owed, stubBridge } from './stubBridge'

const empty = { result: { type: 'empty' } } as const
const ask = (id: number): Request => ({ id, command: { type: 'getAccountInfo' } })

describe('the renderer’s half', () => {
  it('gets the frames in the order they came, those from before it attached first', () => {
    const bridge = stubBridge({ early: [owed(1), owed(2)] })
    const { renderer } = shareBridge(bridge)
    bridge.emit(owed(3))

    const seen: Frame[] = []
    renderer.setSink((frame) => seen.push(frame))
    bridge.emit(owed(4))

    expect(seen).toEqual([owed(1), owed(2), owed(3), owed(4)])
  })

  it('refuses a request outside its own id space before the bridge sees it', () => {
    const bridge = stubBridge()
    const { renderer } = shareBridge(bridge)
    const seen: Frame[] = []
    renderer.setSink((frame) => seen.push(frame))

    renderer.send(ask(-1))
    renderer.send(ask(0))
    renderer.send(ask(1.5))
    renderer.send({ command: { type: 'getAccountInfo' } } as unknown as Request)

    expect(bridge.sent).toEqual([])
    expect(seen.map((frame) => frame.type === 'response' && frame.response.id)).toEqual([
      -1, 0, 1.5,
    ])
    expect(seen.every((frame) => frame.type === 'response' && frame.response.error)).toBe(true)
  })
})

describe('main’s half', () => {
  it('sends on negated ids and gets its answers back on its own', () => {
    const bridge = stubBridge()
    const { main, renderer } = shareBridge(bridge)
    const toMain: Frame[] = []
    const toRenderer: Frame[] = []
    main.setSink((frame) => toMain.push(frame))
    renderer.setSink((frame) => toRenderer.push(frame))

    main.send(ask(1))
    main.send(ask(2))
    expect(bridge.sent.map((request) => request.id)).toEqual([-1, -2])

    bridge.answer(-2, empty)
    expect(toMain).toEqual([{ type: 'response', response: { id: 2, ...empty } }])
    expect(toRenderer).toEqual([])
  })

  it('keeps a late answer from the renderer, attached or not', () => {
    const bridge = stubBridge()
    const { main, renderer } = shareBridge(bridge)
    main.send(ask(1))
    main.close()

    bridge.answer(-1, empty)
    const seen: Frame[] = []
    renderer.setSink((frame) => seen.push(frame))
    bridge.answer(-1, empty)

    expect(seen).toEqual([])
  })

  it('leaves the bridge open when closed', () => {
    const bridge = stubBridge()
    shareBridge(bridge).main.close()
    expect(bridge.closed).toBe(false)
  })
})
