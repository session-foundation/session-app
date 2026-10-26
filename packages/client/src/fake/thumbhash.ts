/**
 * A ThumbHash decoder, for the dev fake only.
 *
 * The real path decodes in C++, where libsession owns the format. This exists because the fake has
 * no addon to borrow that from, and a showcase that draws a flat colour cannot show what a
 * recipient would actually see.
 *
 * Ported from `session::image::thumbhash::decode`, and checked against it: `thumbhash.test.ts`
 * holds vectors that libsession's own decoder produced.
 */

/** RGBA8, row-major, not alpha-premultiplied. */
export interface Decoded {
  width: number
  height: number
  rgba: Uint8Array
}

interface Shape {
  hasAlpha: boolean
  lx: number
  ly: number
  acStart: number
}

function readShape(hash: Uint8Array): Shape {
  const h16 = (hash[3] as number) | ((hash[4] as number) << 8)
  const hasAlpha = ((hash[2] as number) & 0x80) !== 0
  const stored = h16 & 7
  const landscape = h16 >> 15 !== 0
  // The DCT needs three components a side, so a count of 1 or 2 is clamped up here. Only the
  // aspect-ratio reader wants the stored value, and nothing here asks for it.
  return {
    hasAlpha,
    lx: Math.max(3, landscape ? (hasAlpha ? 5 : 7) : stored),
    ly: Math.max(3, landscape ? stored : hasAlpha ? 5 : 7),
    acStart: hasAlpha ? 6 : 5,
  }
}

/**
 * Decodes `hash` into `width` x `height` pixels.
 *
 * The hash's own ratio is approximate (lx/ly, to one part in seven), so the caller passes the
 * attachment's real shape. Decode small: the format holds at most 7 cycles across the image, so a
 * larger decode costs time without carrying more.
 */
export function decodeThumbhash(hash: Uint8Array, width: number, height: number): Decoded {
  if (hash.length < 5) throw new Error('thumbhash: too short')
  const shape = readShape(hash)
  if (shape.hasAlpha && hash.length < 6) throw new Error('thumbhash: truncated before alpha DC')

  const h24 = (hash[0] as number) | ((hash[1] as number) << 8) | ((hash[2] as number) << 16)
  const h16 = (hash[3] as number) | ((hash[4] as number) << 8)
  const lDc = (h24 & 63) / 63
  const pDc = ((h24 >> 6) & 63) / 31.5 - 1
  const qDc = ((h24 >> 12) & 63) / 31.5 - 1
  const lScale = ((h24 >> 18) & 31) / 31
  const pScale = ((h16 >> 3) & 63) / 63
  const qScale = ((h16 >> 9) & 63) / 63
  const aDc = shape.hasAlpha ? ((hash[5] as number) & 15) / 15 : 1
  const aScale = shape.hasAlpha ? ((hash[5] as number) >> 4) / 15 : 0

  let acIndex = 0
  const channel = (nx: number, ny: number, scale: number): number[] => {
    const ac: number[] = []
    for (let cy = 0; cy < ny; cy++)
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        const byte = shape.acStart + (acIndex >> 1)
        if (byte >= hash.length) throw new Error('thumbhash: truncated in AC terms')
        const nib = ((hash[byte] as number) >> ((acIndex & 1) << 2)) & 15
        acIndex++
        ac.push((nib / 7.5 - 1) * scale)
      }
    return ac
  }
  const lAc = channel(shape.lx, shape.ly, lScale)
  // The format boosts chroma by 1.25x on decode to offset quantisation loss.
  const pAc = channel(3, 3, pScale * 1.25)
  const qAc = channel(3, 3, qScale * 1.25)
  const aAc = shape.hasAlpha ? channel(5, 5, aScale) : []

  // The basis separates, so the cosines are computed once per axis rather than per pixel.
  const nx = Math.max(shape.lx, shape.hasAlpha ? 5 : 3) + 1
  const ny = Math.max(shape.ly, shape.hasAlpha ? 5 : 3) + 1
  const fxt = new Float64Array(width * nx)
  const fyt = new Float64Array(height * ny)
  for (let x = 0; x < width; x++)
    for (let cx = 0; cx < nx; cx++) fxt[x * nx + cx] = Math.cos((Math.PI / width) * (x + 0.5) * cx)
  for (let y = 0; y < height; y++)
    for (let cy = 0; cy < ny; cy++) fyt[y * ny + cy] = Math.cos((Math.PI / height) * (y + 0.5) * cy)

  const rgba = new Uint8Array(width * height * 4)
  const to8 = (v: number): number => Math.max(0, Math.trunc(255 * Math.min(1, v)))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let l = lDc
      let p = pDc
      let q = qDc
      let a = aDc

      for (let cy = 0, j = 0; cy < shape.ly; cy++) {
        const fy2 = (fyt[y * ny + cy] as number) * 2
        for (let cx = cy ? 0 : 1; cx * shape.ly < shape.lx * (shape.ly - cy); cx++, j++)
          l += (lAc[j] as number) * (fxt[x * nx + cx] as number) * fy2
      }
      for (let cy = 0, j = 0; cy < 3; cy++) {
        const fy2 = (fyt[y * ny + cy] as number) * 2
        for (let cx = cy ? 0 : 1; cx < 3 - cy; cx++, j++) {
          const f = (fxt[x * nx + cx] as number) * fy2
          p += (pAc[j] as number) * f
          q += (qAc[j] as number) * f
        }
      }
      if (shape.hasAlpha)
        for (let cy = 0, j = 0; cy < 5; cy++) {
          const fy2 = (fyt[y * ny + cy] as number) * 2
          for (let cx = cy ? 0 : 1; cx < 5 - cy; cx++, j++)
            a += (aAc[j] as number) * (fxt[x * nx + cx] as number) * fy2
        }

      const b = l - (2 / 3) * p
      const r = (3 * l - b + q) / 2
      const g = r - q
      const i = (y * width + x) * 4
      rgba[i] = to8(r)
      rgba[i + 1] = to8(g)
      rgba[i + 2] = to8(b)
      rgba[i + 3] = to8(a)
    }
  }

  return { width, height, rgba }
}
