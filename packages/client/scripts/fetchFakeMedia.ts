import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import jpeg from 'jpeg-js'

/**
 * Downloads the thirty dev photographs the fake draws, into the folder desktop reads and mobile's
 * push script copies onto the device, and writes beside each the thumbnail libsession would make
 * of it, which the fake serves once the picture is downloaded.
 *
 * `pnpm fake-media:fetch`. The folder is `$SESSION_FAKE_MEDIA_DIR`, or
 * `~/.cache/session-app/dev-media` when that is unset, which is where desktop's fake and mobile's
 * push script look by default. Kept out of the repository: several megabytes of somebody else's
 * photographs are not something to commit.
 *
 * From Lorem Picsum by seed. Each is checked against its checksum, because the fixtures'
 * ThumbHashes were encoded from these exact files: a different photograph under the same name would
 * draw a placeholder that belongs to another picture.
 */

const PHOTOS: readonly (readonly [string, string])[] = [
  ['unsplash-01.jpg', '60281bdbb955df4aa306adb0f69e1a6b1773e021a2e747a0807de7f319eab592'],
  ['unsplash-02.jpg', '3a37a37b9a93294c0b6c46188d595a86baa722839751b53a1e933f838454d672'],
  ['unsplash-03.jpg', '7cbe810a97ec4f8e0df3af46cc4e6f73ac023abd644bb3f371ddbea82bb838e2'],
  ['unsplash-04.jpg', '07947db1bcb7e9f85ebe7235479c353d94722605598795247af94c5d8f47a40d'],
  ['unsplash-05.jpg', '01366864642461395ccc4e9b9efe1fcee92ca6702a7fcbcd166cdba658ce0088'],
  ['unsplash-06.jpg', 'ba1eab3961cd17d91e6634cf09abe79ec2853bac60e87e44ee7c84cb387c7cce'],
  ['unsplash-07.jpg', '6f82f78bd8332e4829df2d4b5661e1df0a2e867158d1d73f1f10f6d553166689'],
  ['unsplash-08.jpg', '6d6a772ec2a8982f38d7dd0d27c4ef196abc0bb3c84d7b28bd23440c3ae453f2'],
  ['unsplash-09.jpg', '23e103036cffd33bd56c5797be4f838b74b0eb4b50711bb9edd35b933b5494f3'],
  ['unsplash-10.jpg', 'b0c4b846348bedaecb2af7812b2263b895995a537adcd0eceadf512379d89271'],
  ['unsplash-11.jpg', '6c7df30b6ad86b79806ac1c602bb1c4d9b5e42e4d06a1d287f8f1b0c2cdf7d75'],
  ['unsplash-12.jpg', 'bcef75ad842128f6a577aae6bc4f9a87303b2c70475d4925c4c4faafc8d32d21'],
  ['unsplash-13.jpg', '704ea81a9c6a865b3bff1e96c3e50be3d41f64a050bcfaf1ea21eec5346e001e'],
  ['unsplash-14.jpg', '9af63da5945ea0b57a9953a8bc6a459e1f7445e2720def157130e8494cc4d9c9'],
  ['unsplash-15.jpg', '1d97f45bfb9b1edea1e47f97bb8fac44925e3eae9502780b1a541ae2dc8da348'],
  ['unsplash-16.jpg', '79126f666b5d9ba41e9576c3a683e151e4144738ad6a19c07c1d7a186afaa7dd'],
  ['unsplash-17.jpg', '1d5b32532419b30652663410de2299814a62bec5762536a74aba6649e8ba536c'],
  ['unsplash-18.jpg', 'ed20196df6b4595cc5275199d18464941d40f7b1e282f672d602f02a5534702f'],
  ['unsplash-19.jpg', 'b10f31cac48c2d8fa4f8252bc185dae5b030fa8efb73d90a7a2e84f49a19e03f'],
  ['unsplash-20.jpg', '5d1c6451d527b63164a4a937bffb704639cb8b69b5f8e321bddec50793b3d69f'],
  ['unsplash-21.jpg', '4a41a5f41d2acdcaded9d4a9767d868ea93d8682650bf70c6359d10c44d6083a'],
  ['unsplash-22.jpg', '8b4907256b379f99e8267b56893d448e0a61e3c8032e9be9ec99e4d89ff7d02b'],
  ['unsplash-23.jpg', '461b0da24a767f37a7daf16da8d85cbf5b826298d4f91df6ee2e5c69d80e0762'],
  ['unsplash-24.jpg', '49df7d1b4b4b2536175b2ec743639932f25f36d080e0ed68ce32210fc088cb0a'],
  ['unsplash-25.jpg', 'ddba79e0289b303e793efe5bfb27b33cf3f09be57750080b341aaf5b7eca8fda'],
  ['unsplash-26.jpg', '308a0fd4b96883e9f3c390024ec93ae1ceaabd6c6a2297775e22cf0375c0950b'],
  ['unsplash-27.jpg', '32b8a855bb5d6a8ddec5106fa8c0f94c1a4d148a5687b14fa625c7a919f94bc0'],
  ['unsplash-28.jpg', '6ea7eecb3b7761b4932a0aeb7762e3953d26451319b62036e81396e656ec28b8'],
  ['unsplash-29.jpg', 'd97d20d30405ca5651677560d3716e9dcf9f576675e6dcabc9158668fa4aa112'],
  ['unsplash-30.jpg', 'e6889c2c63e990d40ac45cc423a3309e5d83e5ea214d4960463becb54a01024e'],
]

const folder =
  process.env['SESSION_FAKE_MEDIA_DIR'] ?? join(homedir(), '.cache', 'session-app', 'dev-media')

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function source(name: string): string {
  const seed = Number(name.slice('unsplash-'.length, -'.jpg'.length))
  return `https://picsum.photos/seed/session-${String(seed)}/1600/1200.jpg`
}

const ATTEMPTS = 3

async function download(url: string): Promise<Uint8Array> {
  const deadline = new AbortController()
  const timer = setTimeout(() => {
    deadline.abort()
  }, 30_000)
  try {
    const response = await fetch(url, { signal: deadline.signal })
    if (!response.ok) throw new Error(`answered ${String(response.status)}`)
    return new Uint8Array(await response.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message
}

/** A short pause between tries: a CDN's hiccup is not a reason to fail a whole CI run. */
async function downloadWithRetries(name: string): Promise<Uint8Array> {
  const url = source(name)
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await download(url)
    } catch (error) {
      if (attempt === ATTEMPTS) {
        throw new Error(
          `${name}: ${url} failed ${String(ATTEMPTS)} times, last: ${reason(error)}`,
          {
            cause: error,
          },
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt))
    }
  }
}

/** What libsession makes: a square cover, JPEG at quality 90, checkerboard under any alpha. */
const THUMBNAIL_EDGE_PX = 720
const THUMBNAIL_QUALITY = 90
const CHECKER_SQUARE_PX = 8

/** `unsplash-07.jpg` → `thumbnail-07.jpg`, as the fake's `thumbnailFileName` names it. */
function thumbnailName(photo: string): string {
  return photo.replace(/^unsplash-/, 'thumbnail-')
}

/**
 * The centre square of `photo`, box-filtered down to `THUMBNAIL_EDGE_PX` a side. The photographs
 * carry no EXIF orientation, so there is none to apply.
 */
function thumbnail(photo: Uint8Array): Uint8Array {
  const { width, height, data } = jpeg.decode(photo, { useTArray: true, formatAsRGBA: true })
  const side = Math.min(width, height)
  const left = Math.floor((width - side) / 2)
  const top = Math.floor((height - side) / 2)
  const edge = Math.min(THUMBNAIL_EDGE_PX, side)
  const step = side / edge
  const out = new Uint8Array(edge * edge * 4)
  for (let y = 0; y < edge; y += 1) {
    const y0 = top + Math.floor(y * step)
    const y1 = Math.max(y0 + 1, top + Math.floor((y + 1) * step))
    for (let x = 0; x < edge; x += 1) {
      const x0 = left + Math.floor(x * step)
      const x1 = Math.max(x0 + 1, left + Math.floor((x + 1) * step))
      const sum = [0, 0, 0, 0]
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          for (let c = 0; c < 4; c += 1)
            sum[c] = (sum[c] ?? 0) + (data[(sy * width + sx) * 4 + c] ?? 0)
        }
      }
      const count = (y1 - y0) * (x1 - x0)
      const alpha = (sum[3] ?? 0) / count / 255
      const light =
        (Math.floor(x / CHECKER_SQUARE_PX) + Math.floor(y / CHECKER_SQUARE_PX)) % 2 === 0
      const checker = light ? 0xff : 0xcc
      const at = (y * edge + x) * 4
      for (let c = 0; c < 3; c += 1) {
        out[at + c] = Math.round(((sum[c] ?? 0) / count) * alpha + checker * (1 - alpha))
      }
      out[at + 3] = 0xff
    }
  }
  return jpeg.encode({ width: edge, height: edge, data: out }, THUMBNAIL_QUALITY).data
}

function writeWhole(path: string, bytes: Uint8Array): void {
  // The fakes only check that each file exists, so a write cut short must not leave one.
  writeFileSync(`${path}.part`, bytes)
  renameSync(`${path}.part`, path)
}

function mismatchReport(mismatched: readonly string[], checked: number): string {
  const names = mismatched.join(', ')
  if (mismatched.length < checked / 2) {
    return (
      `${String(mismatched.length)} of ${String(checked)} photographs downloaded are not the ones ` +
      `the fixtures were hashed from: ${names}. Run the fetch again; if the same ones fail, ` +
      `Picsum is serving different images for those seeds.`
    )
  }
  return (
    `PICSUM HAS CHANGED: ${String(mismatched.length)} of ${String(checked)} photographs downloaded ` +
    `are not the ones the fixtures were hashed from` +
    (mismatched.length === checked ? '. ' : ` (${names}). `) +
    `Picsum maps a seed to an index into its whole library, and re-encodes each image per ` +
    `request, so an image added there or an encoder upgrade changes every seed at once. The fake ` +
    `cannot start until the photographs are replaced: pick new ones, re-encode the fixtures' ` +
    `ThumbHashes from them, and update the checksums in packages/client/scripts/fetchFakeMedia.ts.`
  )
}

async function main(): Promise<void> {
  mkdirSync(folder, { recursive: true })
  let fetched = 0
  const mismatched: string[] = []
  for (const [name, expected] of PHOTOS) {
    const path = join(folder, name)
    const thumbnailPath = join(folder, thumbnailName(name))
    let bytes: Uint8Array = existsSync(path) ? readFileSync(path) : new Uint8Array()
    if (sha256(bytes) !== expected) {
      bytes = await downloadWithRetries(name)
      // Every one is checked before failing: one wrong file is a bad download, all of them is
      // Picsum.
      if (sha256(bytes) !== expected) {
        mismatched.push(name)
        continue
      }
      writeWhole(path, bytes)
      fetched += 1
    } else if (existsSync(thumbnailPath)) continue
    writeWhole(thumbnailPath, thumbnail(bytes))
  }
  if (mismatched.length > 0) throw new Error(mismatchReport(mismatched, PHOTOS.length))
  console.log(
    `${String(PHOTOS.length)} dev photographs and their thumbnails in ${folder} ` +
      `(${String(fetched)} fetched)`,
  )
}

try {
  await main()
} catch (error) {
  // The message names the photograph and the cause; a stack would only point back here.
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
