/**
 * What every reader of the media scheme must accept and refuse: `@session/app`'s `parseMediaUrl`
 * and desktop's `servableContentType` in TypeScript, and the shim's `parse_media_url` and
 * `servable_content_type` in C++, which both mobile loaders call. The C++ half is held to this
 * table by every test that runs the shim against it.
 */

export interface MediaUrlVector {
  url: string
  /** What it parses to, or null for a URL that must be refused. */
  parsed: { kind: 'attachment' | 'preview'; messageId: number; index: number } | null
}

const S = 'session-media://'

export const MEDIA_URL_VECTORS: readonly MediaUrlVector[] = [
  { url: `${S}attachment/1/0`, parsed: { kind: 'attachment', messageId: 1, index: 0 } },
  { url: `${S}attachment/42/7`, parsed: { kind: 'attachment', messageId: 42, index: 7 } },
  { url: `${S}preview/42/0`, parsed: { kind: 'preview', messageId: 42, index: 0 } },
  {
    url: `${S}attachment/9007199254740991/0`,
    parsed: { kind: 'attachment', messageId: Number.MAX_SAFE_INTEGER, index: 0 },
  },
  {
    url: `${S}preview/1/9007199254740991`,
    parsed: { kind: 'preview', messageId: 1, index: Number.MAX_SAFE_INTEGER },
  },

  // Another scheme, whatever its shape.
  { url: 'file:///etc/passwd', parsed: null },
  { url: 'http://attachment/42/1', parsed: null },
  { url: 'session-media:attachment/42/1', parsed: null },
  { url: 'session-media:/attachment/42/1', parsed: null },
  // The canonical form only: Chromium lowercases before a handler sees it.
  { url: 'SESSION-MEDIA://attachment/42/1', parsed: null },
  { url: `${S}Attachment/42/1`, parsed: null },

  // An authority it does not serve, or one with more in it than the word.
  { url: `${S}thumbnail/42/1`, parsed: null },
  { url: `${S}42/1`, parsed: null },
  { url: `${S}attachment:80/42/1`, parsed: null },
  { url: `${S}user@attachment/42/1`, parsed: null },

  // Anything but the pair.
  { url: `${S}attachment/42/1/original`, parsed: null },
  { url: `${S}attachment/42/1/`, parsed: null },
  { url: `${S}attachment/42`, parsed: null },
  { url: `${S}attachment//42/1`, parsed: null },
  { url: `${S}attachment/./42/1`, parsed: null },

  // A message id is a rowid, so zero names nothing; an index counts from zero.
  { url: `${S}attachment/0/1`, parsed: null },
  { url: `${S}attachment/-1/0`, parsed: null },
  { url: `${S}attachment/42/-1`, parsed: null },

  // Only plain decimal ids.
  ...[
    '4.2/0',
    'nine/0',
    '42/',
    '0x2A/1',
    '1e1/0',
    '+42/0',
    '42/-0',
    '042/1',
    '42/01',
    '%34%32/1',
  ].map((pair) => ({ url: `${S}attachment/${pair}`, parsed: null })),
  { url: `${S}attachment/ 42/1`, parsed: null },
  // ASCII digits only: not Arabic-Indic, not fullwidth.
  { url: `${S}attachment/\u0664\u0662/1`, parsed: null },
  { url: `${S}attachment/\uff14\uff12/1`, parsed: null },

  // Past the largest safe integer, which Number() would round rather than refuse.
  { url: `${S}attachment/9007199254740992/0`, parsed: null },
  { url: `${S}attachment/9007199254740993/0`, parsed: null },
  { url: `${S}attachment/42/9007199254740993`, parsed: null },
  { url: `${S}attachment/12345678901234567/0`, parsed: null },

  { url: `${S}attachment/42/1?x=1`, parsed: null },
  { url: `${S}attachment/42/1#f`, parsed: null },
  // Nothing past the pair, not even a byte a C string would end at or a line would.
  { url: `${S}attachment/1/0\0`, parsed: null },
  { url: `${S}attachment/1/0\n`, parsed: null },
  { url: `${S}/`, parsed: null },
  { url: S, parsed: null },
  { url: '', parsed: null },
  { url: 'not a url', parsed: null },
]

function ascii(text: string, length = 16): Uint8Array {
  const out = new Uint8Array(Math.max(length, text.length))
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i)
  return out
}

const PNG = ascii('\x89PNG\r\n\x1a\n\0\0\0\rIHDR')
const JPEG = ascii('\xff\xd8\xff\xe0\0\x10JFIF')
const GIF87 = ascii('GIF87a')
const GIF89 = ascii('GIF89a')
const WEBP = ascii('RIFF\x24\0\0\0WEBPVP8 ')
const BMP = ascii('BM\x36\0\0\0')
const MP4 = ascii('\0\0\0\x18ftypmp42')
const WEBM = ascii('\x1a\x45\xdf\xa3')
const OGG = ascii('OggS\0\x02')
const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

export interface ServableVector {
  declared: string
  bytes: Uint8Array
  /** The type the bytes are handed on as, or null for bytes that must not reach a decoder. */
  served: string | null
}

export const SERVABLE_VECTORS: readonly ServableVector[] = [
  { declared: 'image/png', bytes: PNG, served: 'image/png' },
  { declared: 'image/jpeg', bytes: JPEG, served: 'image/jpeg' },
  { declared: 'image/jpg', bytes: JPEG, served: 'image/jpeg' },
  { declared: 'image/gif', bytes: GIF87, served: 'image/gif' },
  { declared: 'image/gif', bytes: GIF89, served: 'image/gif' },
  { declared: 'image/webp', bytes: WEBP, served: 'image/webp' },
  { declared: 'image/bmp', bytes: BMP, served: 'image/bmp' },
  { declared: 'image/apng', bytes: PNG, served: 'image/png' },
  { declared: 'video/mp4', bytes: MP4, served: 'video/mp4' },
  { declared: 'video/webm', bytes: WEBM, served: 'video/webm' },
  { declared: 'video/ogg', bytes: OGG, served: 'video/ogg' },
  { declared: 'Image/PNG; charset=binary', bytes: PNG, served: 'image/png' },
  { declared: '  image/png  ', bytes: PNG, served: 'image/png' },
  // Only ASCII space is trimmed off a declared type: a no-break space is not, on any platform.
  { declared: '\u00a0image/png', bytes: PNG, served: null },

  // The wrong image format named: what the bytes are is what is served.
  { declared: 'image/png', bytes: JPEG, served: 'image/jpeg' },
  { declared: 'video/webm', bytes: MP4, served: 'video/mp4' },

  // SVG is a document that can carry script, whatever the bytes are.
  { declared: 'image/svg+xml', bytes: SVG, served: null },
  { declared: 'image/svg+xml', bytes: PNG, served: null },

  // A type that is not viewable.
  { declared: 'application/octet-stream', bytes: PNG, served: null },
  { declared: 'text/html', bytes: PNG, served: null },
  { declared: '', bytes: PNG, served: null },
  { declared: 'image/', bytes: PNG, served: null },

  // Bytes that are not the declared family.
  { declared: 'image/png', bytes: SVG, served: null },
  { declared: 'image/png', bytes: ascii('<html><script>'), served: null },
  { declared: 'image/png', bytes: MP4, served: null },
  { declared: 'video/mp4', bytes: PNG, served: null },

  // Too short to carry a signature.
  { declared: 'image/png', bytes: new Uint8Array(), served: null },
  { declared: 'image/png', bytes: PNG.subarray(0, 4), served: null },
  { declared: 'image/webp', bytes: ascii('RIFF', 4), served: null },
  { declared: 'video/mp4', bytes: MP4.subarray(0, 7), served: null },
]
