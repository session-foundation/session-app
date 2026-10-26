/**
 * The JSI transport's half of "a request the shim never saw is still answered".
 *
 * The addon's version of this is packages/bridge-node/tests/addon.test.ts, run against the real
 * C++. There is no JSI outside an app, so the bridge is stood in for here and what is under test
 * is the transport's own handling rather than the converter that produces the throw.
 */

import { describe, expect, it, vi } from 'vitest'

import type { Frame, SessionBridgeOptions } from '@session/bridge-types'

const bridge = vi.hoisted(() => ({
  setSink: vi.fn(),
  init: vi.fn(),
  call: vi.fn(),
  fetchMedia: vi.fn(),
  fetchThumbhash: vi.fn(),
  fetchThumbnail: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@session/bridge-rn', () => ({ createSessionBridge: () => bridge }))

const { createNativeBridgeTransport } = await import('#src/nativeTransport.native')

const options: SessionBridgeOptions = {
  dbPath: '/nowhere/session.db',
  cacheDir: '/nowhere/cache',
  deferAccount: true,
}

const unreadable = { id: 8, command: { type: 'setDisplayName', name: 5 } } as unknown as Parameters<
  ReturnType<typeof createNativeBridgeTransport>['send']
>[0]

describe('the JSI transport', () => {
  it('answers a request JSI could not read on the stream, not by throwing', () => {
    const transport = createNativeBridgeTransport(options)
    const frames: Frame[] = []
    transport.setSink((frame) => frames.push(frame))

    bridge.call.mockImplementationOnce(() => {
      throw new TypeError('SetDisplayNameCommand.name: expected a string')
    })

    expect(() => {
      transport.send(unreadable)
    }).not.toThrow()
    expect(frames).toEqual([
      {
        type: 'response',
        response: { id: 8, error: 'SetDisplayNameCommand.name: expected a string' },
      },
    ])
  })

  it('holds that answer until there is a sink, as it does any other frame', () => {
    const transport = createNativeBridgeTransport(options)

    bridge.call.mockImplementationOnce(() => {
      throw new TypeError('SetDisplayNameCommand.name: expected a string')
    })
    transport.send(unreadable)

    const frames: Frame[] = []
    transport.setSink((frame) => frames.push(frame))
    expect(frames).toHaveLength(1)
  })

  it('hands back the bridge bytes as a view of the same buffer', async () => {
    const transport = createNativeBridgeTransport(options)
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff]).buffer
    const rgba = new Uint8Array(4 * 2 * 3).buffer
    bridge.fetchMedia.mockResolvedValueOnce({ contentType: 'image/jpeg', bytes })
    bridge.fetchThumbhash.mockResolvedValueOnce({ width: 2, height: 3, rgba })

    const media = await transport.fetchMedia({ messageId: 4, index: 1 })
    expect(bridge.fetchMedia).toHaveBeenLastCalledWith(4, 1)
    expect(media.contentType).toBe('image/jpeg')
    expect(media.bytes).toBeInstanceOf(Uint8Array)
    expect(media.bytes.buffer).toBe(bytes)

    const thumbhash = await transport.fetchThumbhash({ messageId: 4, index: 1 })
    expect(thumbhash).toMatchObject({ width: 2, height: 3 })
    expect(thumbhash.rgba.buffer).toBe(rgba)

    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff]).buffer
    bridge.fetchThumbnail.mockResolvedValueOnce(jpeg)
    const thumbnail = await transport.fetchThumbnail({ messageId: 4, index: 1 })
    expect(bridge.fetchThumbnail).toHaveBeenLastCalledWith(4, 1)
    expect(thumbnail.buffer).toBe(jpeg)
  })

  it('refuses media once closed rather than asking a closed bridge', async () => {
    const transport = createNativeBridgeTransport(options)
    transport.close()
    bridge.fetchMedia.mockClear()
    await expect(transport.fetchMedia({ messageId: 4, index: 0 })).rejects.toThrow('closed')
    await expect(transport.fetchThumbhash({ messageId: 4, index: 0 })).rejects.toThrow('closed')
    await expect(transport.fetchThumbnail({ messageId: 4, index: 0 })).rejects.toThrow('closed')
    expect(bridge.fetchMedia).not.toHaveBeenCalled()
  })
})
