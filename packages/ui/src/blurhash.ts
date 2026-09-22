/**
 * The alphabet a BlurHash is written in, in its own order.
 *
 * Not base64 and not sorted: the positions are the values, so this string is the specification.
 */
const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

/** The shortest a hash can be: the size flag, the maximum AC value, and the four DC characters. */
const MIN_LENGTH = 6

function decode83(text: string): number | null {
  let value = 0
  for (const character of text) {
    const digit = ALPHABET.indexOf(character)
    if (digit < 0) return null
    value = value * 83 + digit
  }
  return value
}

/**
 * The average colour of the picture a BlurHash describes, as a CSS colour.
 *
 * **The DC term only.** A BlurHash is a handful of cosine components; the first is the flat
 * average and the rest are the gradient that makes it look like a blurred photograph. Drawing the
 * gradient means rasterising pixels, and there is nowhere to put them that both platforms have -
 * no canvas on native, and no image decoder in this package - so what is drawn is the one term
 * that needs no rasteriser. It is still the picture's own colour rather than a theme grey, which
 * is the whole of what a placeholder is for.
 *
 * Null for anything that is not a hash, including the empty string: a sender's claim is checked
 * here because nothing before this point looks inside it, and a malformed one must draw the
 * ordinary placeholder rather than a colour derived from nonsense.
 */
export function blurhashColor(hash: string): string | null {
  if (hash.length < MIN_LENGTH) return null

  const size = decode83(hash[0] ?? '')
  if (size === null) return null
  // The two component counts are packed into one character, and the length follows from them.
  // A hash whose length disagrees is one somebody truncated, and its DC may be intact - but
  // nothing here can tell that from a different hash, so it is refused.
  const across = (size % 9) + 1
  const down = Math.floor(size / 9) + 1
  if (hash.length !== 4 + 2 * across * down) return null

  const dc = decode83(hash.slice(2, 6))
  if (dc === null) return null

  // Already sRGB, one byte per channel, so there is no linear-to-sRGB step for this term.
  const red = (dc >> 16) & 255
  const green = (dc >> 8) & 255
  const blue = dc & 255
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`
}
