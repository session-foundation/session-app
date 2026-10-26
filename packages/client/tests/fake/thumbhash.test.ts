import { toHex } from '@session/basic-types'
import { describe, expect, it } from 'vitest'

import { decodeThumbhash } from '#src/fake/thumbhash'

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? [])
}

/**
 * Hash and expected pixels, both produced by `session::image::thumbhash` itself.
 *
 * The hashes are three of the dev photographs and two synthetic images, encoded by libsession; the
 * pixels are what libsession's own decoder returns for them at 8x6. That is the whole point of the
 * vectors: this decoder exists only because the fake has no addon, so what it must match is the
 * real one.
 */
const VECTORS: readonly (readonly [string, string])[] = [
  [
    'd5280a3d8a8577777f76778286e7888c8775705807',
    '3a658cff5480a7ff5481aaff537fa7ff5d87acff6287a9ff6384a2ff607e9aff2d2722ff433e39ff44403cff45413eff504a44ff564c43ff5e5043ff625142ff905521ff9c622eff975f2cff975f2dff9d6430ffa3662fffb27238ffbe7b3fffbe793bffc17d40ffb67439ffb37238ffb7753affbd783bffd08848ffdd9351ff5b3819ff5b3b1dff513317ff503319ff55371dff5c3d21ff6c4a2bff724e2dff0b0f13ff0d1319ff060f17ff07121bff0c1720ff121b22ff1a2025ff161a1eff',
  ],
  [
    'e2f7151d828877877f87888a877888887b409d07d5',
    'f9ffffffe6eff9ffebf3fcffe9f0f9ffeaf1faffe8eef8ffd5dce8ffdce3f0ffa9b5c6ffabb7c8ffb9c4d5ffb2bcceffb5c0d3ffbdc8deffb2bdd5ffbac6dfff748192ff8793a4ff8f9baeff727f94ff6e7b94ff7d8ba8ff7786a7ff8392b6ff5b615eff717775ff6d7374ff3e454bff363e4bff475064ff444f68ff57627fff58522eff6d6745ff656043ff3a3520ff383528ff43423dff393a3dff4f5158ff7b6a2cff8e7e43ff887944ff65572aff665a37ff635a41ff4b4333ff5d574aff',
  ],
  [
    'aa390e2d869b88777f88777776a78783686f548405',
    'edffbafffdffbeffeef09dffecdf8dfff9e493fff3de90ffebdb91ffe6dc93ffffffcaffffffc3ffffed9fffffe093ffffe599ffffdc94ffffda95fffedd9bfff9dc9dffeec788ffd39d5effd39153ffd99256ffc9854dffc38753ffc58f5efff3d1a9ffe3b890ffc89069ffc98761ffc98463ffb8785cffb88169ffbd8d78ffdbd0c3ffd5c2b5ffc7a89dffcca49cffc69d99ffb18f91ffaf979fffaf9faaff67757bff6d7279ff6b666eff70636eff615464ff433d54ff373c59ff2e3b5bff',
  ],
  // 32x32 with a radial alpha falloff: the only vector that reaches the alpha channel.
  [
    'df18821d0626f249be44985376024a07187708788888808978',
    '5e8a8f146790802b75976a47859c575b8f9a4d5e95935047958959149582600063878d366c8c7f577a936a818997579f93954ea6988d528b98845b52977d63206b818b5474867d7f828c69b78f9058de998d51e59c8556c49c7a61849b73694d737a8a587b7f7d8688856ac195885ae69d8456e9a07b5cc49f7068839d69714d79758a2b81797d558d7f6c8a98815ea99f7d5ba8a17363879f68704e9d607a1f7b728a0083767e0d8e7b6d3b9a7d6056a0795e55a16f673b9f63750c9d5b7f00',
  ],
  // Opaque 24x40: portrait, so the luminance grid is 7 tall rather than 7 wide.
  [
    '21180a4414e0f66c855788878788013c071878',
    '15baf7ff3dd7dcff70f5a6ff94fb65ffa8ea39ffbedb3effdedb6cfff8e397ff1ca6ecff39b8c8ff5fc989ff7dc846ff95bb22ffb5b435ffdebd70fffdcaa2ff3292e8ff4398bcff5c9b75ff769435ff948b1fffbd8d43ffec9b89ffffaac0ff2e64d0ff3a65a2ff50635fff6e5f2bff945d26ffc16256ffed6ca0ffff75d5ff2a41c2ff343f95ff4a3e57ff6d3e30ff983f38ffc3406dffe641b3fff940e2ff161eabff221e81ff3d204cff672831ff9a3045ffc83482ffe931c8fff82df6ff',
  ],
]

describe('the dev ThumbHash decoder', () => {
  it('agrees with libsession, byte for byte', () => {
    for (const [hash, expected] of VECTORS) {
      const decoded = decodeThumbhash(bytes(hash), 8, 6)
      expect(decoded.width).toBe(8)
      expect(decoded.height).toBe(6)
      expect(toHex(decoded.rgba)).toBe(expected)
    }
  })

  it('refuses a hash too short to carry a header', () => {
    expect(() => decodeThumbhash(bytes('d5280a'), 8, 6)).toThrow(/too short/)
  })

  it('refuses a hash that declares alpha but stops before the alpha DC', () => {
    expect(() => decodeThumbhash(bytes('df18821d06'), 8, 6)).toThrow(/before alpha DC/)
  })

  it('refuses one truncated partway through its coefficients', () => {
    expect(() => decodeThumbhash(bytes('d5280a3d8a'), 8, 6)).toThrow(/truncated/)
  })
})
