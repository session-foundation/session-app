import { describe, expect, it } from 'vitest'

import { blurhashColor } from '#src/blurhash'

describe('the colour behind a picture that has not arrived', () => {
  it('reads the average out of a real hash', () => {
    // The blurhash project's own example, a 4x3. Its DC characters are `HV6n`, which is
    // 9934485, which is these three bytes.
    expect(blurhashColor('LEHV6nWB2yk8pyo0adR*.7kCMdnj')).toBe('rgb(151, 150, 149)')
  })

  it('reads a hash carrying nothing but its average', () => {
    // 1x1 components: six characters, and the whole picture is one colour. Nothing sends these,
    // but the length rule admits them and a decoder that choked would be wrong about the spec.
    const flat = blurhashColor('00T0}u')
    expect(flat).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
  })

  it('refuses a hash whose length disagrees with its own component counts', () => {
    // Truncation is the likely cause and the DC may well be intact - but nothing here can tell
    // that from a different hash, so a colour drawn from it would be a guess presented as fact.
    expect(blurhashColor('LEHV6nWB2yk8pyo0adR*.7kCMdn')).toBeNull()
    expect(blurhashColor('LEHV6nWB2yk8pyo0adR*.7kCMdnjX')).toBeNull()
  })

  it('refuses a character that is not in the alphabet', () => {
    // Base83 rather than base64, and the alphabet's order is the specification.
    expect(blurhashColor('LE"V6nWB2yk8pyo0adR*.7kCMdnj')).toBeNull()
  })

  it('does not inspect the components it never reads', () => {
    // Only the four DC characters are decoded, so a hash whose gradient is nonsense still has a
    // valid average and that average is what gets drawn. Checking the rest would be work done to
    // reject something that cannot affect the answer.
    expect(blurhashColor('LEHV6nWB2yk8pyo0adR*.7kCMdn"')).toBe('rgb(151, 150, 149)')
  })

  it('refuses anything too short to be a hash, including nothing at all', () => {
    expect(blurhashColor('')).toBeNull()
    expect(blurhashColor('LEHV6')).toBeNull()
  })
})
