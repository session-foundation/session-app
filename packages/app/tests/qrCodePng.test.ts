import { inflateSync } from 'node:zlib'

import { qrMarkModules } from '@session/basic-types'
import { encode } from 'uqr'
import { describe, expect, it } from 'vitest'

import { qrCodePng } from '#src/qrCodePng'

/** The encoder's quiet zone and pixels per module. */
const QUIET_MODULES = 4
const MODULE_PX = 16

/** The size, bit depth and first row of a one-IDAT, one-bit greyscale PNG, decoded by zlib. */
function decode(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const idatLength = view.getUint32(33)
  const raw = inflateSync(png.subarray(41, 41 + idatLength))
  const rowBytes = Math.ceil(width / 8)
  return { width, height, depth: png[24], raw, rowBytes, firstRow: raw.subarray(1, 1 + rowBytes) }
}

describe('qrCodePng', () => {
  it('draws a square code with a white quiet zone around it', () => {
    const { width, height, depth, raw, rowBytes, firstRow } = decode(
      qrCodePng('0123456789abcdef0123456789abcdef'),
    )
    expect(width).toBe(height)
    expect(width % 16).toBe(0)
    expect(depth).toBe(1)
    // A standard zlib decoder accepts the stored blocks, and every row is there.
    expect(raw.length).toBe((rowBytes + 1) * height)
    // The top rows are quiet zone, all white; a dark module starts where the code does.
    expect(firstRow.every((byte, at) => byte === 255 || at === rowBytes - 1)).toBe(true)
    expect(raw.some((byte, at) => at % (rowBytes + 1) !== 0 && byte !== 255)).toBe(true)
  })

  it("draws the recovery password's mark in the middle, and changes nothing outside its square", () => {
    const value = '0123456789abcdef0123456789abcdef'
    const plain = decode(qrCodePng(value))
    const marked = decode(qrCodePng(value, 'recoveryPassword'))
    expect(marked.width).toBe(plain.width)
    const white = (raw: Uint8Array, x: number, y: number) =>
      ((raw[y * (plain.rowBytes + 1) + 1 + (x >>> 3)] ?? 0) & (0x80 >>> (x & 7))) !== 0
    const centre = plain.width / 2
    let insideChanged = 0
    let outsideChanged = 0
    let markInk = 0
    for (let y = 0; y < plain.height; y += 1) {
      for (let x = 0; x < plain.width; x += 1) {
        const differs = white(plain.raw, x, y) !== white(marked.raw, x, y)
        // Generously inside: the square is about a quarter of the code's width.
        const near =
          Math.abs(x - centre) < plain.width * 0.2 && Math.abs(y - centre) < plain.width * 0.2
        if (differs && near) insideChanged += 1
        if (differs && !near) outsideChanged += 1
        if (near && !white(marked.raw, x, y)) markInk += 1
      }
    }
    expect(outsideChanged).toBe(0)
    expect(insideChanged).toBeGreaterThan(0)
    expect(markInk).toBeGreaterThan(0)
    // Just inside the cleared square's left edge, on its middle row: panel, where the plain code
    // has a module, and white either way now.
    const { size } = encode(value, { ecc: 'Q', border: 0 })
    const squareLeftPx = (QUIET_MODULES + (size - qrMarkModules(size)) / 2) * MODULE_PX
    expect(white(marked.raw, squareLeftPx + 1, Math.floor(centre))).toBe(true)
  })

  it('spans more than one stored block for a long value', () => {
    const { raw, rowBytes, height } = decode(qrCodePng('a'.repeat(200)))
    expect(raw.length).toBe((rowBytes + 1) * height)
    expect(raw.length).toBeGreaterThan(0xffff)
  })
})
