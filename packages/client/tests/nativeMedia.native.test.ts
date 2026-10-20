/**
 * What JavaScript hands the native loaders when it serves them. There is no JSI outside an app, so
 * the HybridObject is stood in for; the loader and the C++ behind it are exercised on a device.
 */

import { describe, expect, it, vi } from 'vitest'

import type { MediaSource } from '#src/types'

type Serve = (
  fetchMedia: (
    messageId: number,
    index: number,
  ) => Promise<{ contentType: string; bytes: ArrayBuffer }>,
  fetchPreview: (
    messageId: number,
    index: number,
  ) => Promise<{ width: number; height: number; rgba: ArrayBuffer }>,
) => void

const bridges = vi.hoisted(
  () => [] as { serveMediaFrom: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[],
)

const older = vi.hoisted(() => ({ value: false }))

vi.mock('@session/bridge-rn', () => ({
  createSessionBridge: () => {
    if (older.value) return { close: vi.fn() }
    const bridge = { serveMediaFrom: vi.fn(), close: vi.fn() }
    bridges.push(bridge)
    return bridge
  },
}))

const { serveNativeMediaFrom } = await import('#src/nativeMedia.native')

function served(at: number): Parameters<Serve> {
  const bridge = bridges[at]
  if (!bridge) throw new Error('nothing was served')
  return bridge.serveMediaFrom.mock.calls[0] as Parameters<Serve>
}

describe('serving the native loaders from JavaScript', () => {
  it('answers each loader with exactly the bytes of the view the source gave', async () => {
    const whole = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
    const within = new Uint8Array([9, 9, 1, 2, 3, 4, 9]).subarray(2, 6)
    const source: MediaSource = {
      fetchMedia: () => Promise.resolve({ contentType: 'image/jpeg', bytes: whole }),
      fetchPreview: () => Promise.resolve({ width: 1, height: 1, rgba: within }),
    }
    serveNativeMediaFrom(source)
    const [fetchMedia, fetchPreview] = served(bridges.length - 1)

    const media = await fetchMedia(4, 0)
    expect(media.contentType).toBe('image/jpeg')
    expect(media.bytes).toBe(whole.buffer)

    const preview = await fetchPreview(4, 0)
    expect(preview).toMatchObject({ width: 1, height: 1 })
    expect([...new Uint8Array(preview.rgba)]).toEqual([1, 2, 3, 4])
  })

  it('passes a failure through, so the loader fails the image rather than waiting', async () => {
    const source: MediaSource = {
      fetchMedia: () => Promise.reject(new Error('not a picture')),
      fetchPreview: () => Promise.reject(new Error('no preview: no hash')),
    }
    serveNativeMediaFrom(source)
    const [fetchMedia, fetchPreview] = served(bridges.length - 1)
    await expect(fetchMedia(4, 1)).rejects.toThrow('not a picture')
    await expect(fetchPreview(4, 1)).rejects.toThrow('no hash')
  })

  it('closes what served before, so two sources never answer at once', () => {
    const source: MediaSource = {
      fetchMedia: () => Promise.reject(new Error('unused')),
      fetchPreview: () => Promise.reject(new Error('unused')),
    }
    serveNativeMediaFrom(source)
    const before = bridges.at(-1)
    serveNativeMediaFrom(source)
    expect(before?.close).toHaveBeenCalledOnce()
    expect(bridges.at(-1)?.close).not.toHaveBeenCalled()
  })

  it('says to rebuild the dev client when its native side predates serveMediaFrom', () => {
    const source: MediaSource = {
      fetchMedia: () => Promise.reject(new Error('unused')),
      fetchPreview: () => Promise.reject(new Error('unused')),
    }
    older.value = true
    try {
      expect(() => {
        serveNativeMediaFrom(source)
      }).toThrow('pnpm android')
    } finally {
      older.value = false
    }
  })
})
