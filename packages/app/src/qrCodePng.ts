import { QR_MARK_FILL, QR_MARK_OUTLINES, qrMarkModules, type QrMark } from '@session/basic-types'
import { encode } from 'uqr'

import { rasterizeMark } from './markRaster'

/**
 * The longest text drawn: a community's full URL at libsession's limit
 * (`community::FULL_URL_MAX_LENGTH`, less its terminator). A recovery password's seed is 32 or 64
 * characters.
 */
export const MAX_QR_TEXT_CHARS = 410

/** Pixels per module, so a saved code prints and scans at any reasonable size. */
const MODULE_PX = 16
/** Modules of white around the code: the quiet zone a scanner needs. */
const QUIET_MODULES = 4
/** The most a stored deflate block holds. */
const STORED_BLOCK_BYTES = 0xffff

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/**
 * A zlib stream of stored (uncompressed) blocks. No compressor is needed, which is what lets the
 * phones build the same file as the desktop; at one bit a pixel a code is still only tens of kB.
 */
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / STORED_BLOCK_BYTES))
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4)
  let at = 0
  out[at++] = 0x78
  out[at++] = 0x01
  for (let block = 0; block < blocks; block += 1) {
    const start = block * STORED_BLOCK_BYTES
    const length = Math.min(STORED_BLOCK_BYTES, data.length - start)
    out[at++] = block === blocks - 1 ? 1 : 0
    out[at++] = length & 0xff
    out[at++] = length >>> 8
    out[at++] = ~length & 0xff
    out[at++] = (~length >>> 8) & 0xff
    out.set(data.subarray(start, start + length), at)
    at += length
  }
  new DataView(out.buffer).setUint32(at, adler32(data))
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * A QR code of `value` as a PNG: black modules on white, with its quiet zone, and `mark` in the
 * middle where there is one, drawn as on screen: the same square cleared, the mark at the same
 * share of it. Level Q, as drawn on screen, which restores the modules the mark covers. One-bit
 * greyscale, so it needs nothing but this file and the mark's outline to build on any platform.
 */
export function qrCodePng(value: string, mark: QrMark | null = null): Uint8Array {
  const { size, data } = encode(value, { ecc: 'Q', border: QUIET_MODULES })
  const side = size * MODULE_PX

  // The cleared square and the mark in it, in pixels, measured as the screen measures them: on the
  // code without its quiet zone.
  const clearedModules = mark === null ? 0 : qrMarkModules(size - 2 * QUIET_MODULES)
  const clearedStart = (size - clearedModules) / 2
  const markBoxPx = Math.round(clearedModules * MODULE_PX * QR_MARK_FILL)
  const markStartPx = Math.round((side - markBoxPx) / 2)
  const markInk = mark === null ? null : rasterizeMark(QR_MARK_OUTLINES[mark], markBoxPx, markBoxPx)
  const cleared = (moduleX: number, moduleY: number) =>
    moduleX >= clearedStart &&
    moduleX < clearedStart + clearedModules &&
    moduleY >= clearedStart &&
    moduleY < clearedStart + clearedModules
  const inkAt = (x: number, y: number): boolean => {
    const moduleX = Math.floor(x / MODULE_PX)
    const moduleY = Math.floor(y / MODULE_PX)
    if (markInk !== null && cleared(moduleX, moduleY)) {
      const mx = x - markStartPx
      const my = y - markStartPx
      return (
        mx >= 0 && my >= 0 && mx < markBoxPx && my < markBoxPx && markInk[my * markBoxPx + mx] === 1
      )
    }
    return data[moduleY]?.[moduleX] === true
  }

  const rowBytes = Math.ceil(side / 8)
  // Each row is its filter byte (0, none) then the pixels, a set bit being white.
  const raw = new Uint8Array((rowBytes + 1) * side)
  for (let y = 0; y < side; y += 1) {
    const rowStart = y * (rowBytes + 1) + 1
    for (let x = 0; x < side; x += 1) {
      if (inkAt(x, y)) continue
      const at = rowStart + (x >>> 3)
      raw[at] = (raw[at] ?? 0) | (0x80 >>> (x & 7))
    }
  }

  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, side)
  view.setUint32(4, side)
  header[8] = 1 // bit depth
  header[9] = 0 // colour type: greyscale
  // Compression, filter and interlace method each have one defined value, which is 0.

  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
