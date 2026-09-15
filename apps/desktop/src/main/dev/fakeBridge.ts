import type { BridgeTransport } from '@session/client'
import { createFakeTransport, crowd, friends } from '@session/client/fake'

import type { MediaSource } from '../media'

/**
 * A one-pixel PNG, per attachment, in a colour derived from what it belongs to.
 *
 * Enough for the media scheme to be exercised end to end without a network: a test can assert
 * that a picture drew, and `dev:fake` shows something rather than a broken image. Deliberately
 * not a real photograph - a fixture that has to be looked at is a fixture nobody updates.
 */
function swatchPng(messageId: number, index: number): Uint8Array {
  const hue = (messageId * 37 + index * 89) % 360
  const [r, g, b] = hslToRgb(hue)

  // A minimal PNG: signature, IHDR for 1x1 truecolour, IDAT holding one uncompressed deflate
  // block, IEND. Written out because generating it is a dozen bytes and a dependency is not.
  const ihdr = chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]))
  const raw = new Uint8Array([0, r, g, b])
  const deflate = new Uint8Array([0x78, 0x01, 0x01, 4, 0, 0xfb, 0xff, ...raw, ...adler32(raw)])
  const idat = chunk('IDAT', deflate)
  const iend = chunk('IEND', new Uint8Array())
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...ihdr,
    ...idat,
    ...iend,
  ])
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new Uint8Array([...type].map((c) => c.charCodeAt(0)))
  const body = new Uint8Array([...name, ...data])
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, data.length)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(body))
  return new Uint8Array([...length, ...body, ...crc])
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number[] {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return [b >> 8, b & 0xff, a >> 8, a & 0xff]
}

function hslToRgb(hue: number): [number, number, number] {
  const section = hue / 60
  const x = Math.round(255 * (1 - Math.abs((section % 2) - 1)))
  const table: [number, number, number][] = [
    [255, x, 0],
    [x, 255, 0],
    [0, 255, x],
    [0, x, 255],
    [x, 0, 255],
    [255, 0, x],
  ]
  return table[Math.floor(section) % 6] ?? [255, 0, 0]
}

/**
 * The bridge, backed by the fake.
 *
 * This is a dev entry and lives here so the boundary rules can say so: production code
 * never imports the fake, and the dynamic import in ../bridge.ts is what keeps it out of a
 * shipped bundle.
 */
export function createFakeBridge(): BridgeTransport & MediaSource {
  // A conversation list big enough to measure, when something asks for one. The default stays the
  // two-account fixture, so nothing about the ordinary dev loop changes.
  const peers = Number(process.env['SESSION_FAKE_CONVERSATIONS'] ?? '0')
  const { world, clients } =
    peers > 0
      ? crowd({ peers, history: Number(process.env['SESSION_FAKE_HISTORY'] ?? '1') })
      : friends(['Alice', 'Bob'], { history: 4 })
  const alice = clients['Alice']
  if (!alice) throw new Error('the fixture did not produce a client')

  // The fake's clock is manual so tests can decide when a send lands. Running the app there
  // is nobody to advance it, so let it tick.
  const ticking = setInterval(() => {
    world.settle()
  }, 50)
  ticking.unref?.()

  return {
    ...createFakeTransport(alice),
    fetchMedia(messageId: number, index: number) {
      return Promise.resolve({ contentType: 'image/png', bytes: swatchPng(messageId, index) })
    },
  }
}
