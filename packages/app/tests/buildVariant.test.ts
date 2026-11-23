import { afterEach, describe, expect, it } from 'vitest'

import { buildTraits } from '#src/buildTraits'
import { BUILD_VARIANTS, VARIANT_TRAITS, resolveBuildVariant } from '#src/buildVariant'
import { memoryPorts, resetPorts, setPorts } from '#src/index'

afterEach(() => {
  resetPorts()
})

describe('resolving the build variant', () => {
  it('reports what the platform detected when nothing overrides it', () => {
    expect(resolveBuildVariant(undefined, 'huawei')).toBe('huawei')
    expect(resolveBuildVariant('', 'testFlight')).toBe('testFlight')
  })

  it('takes the override over what was detected', () => {
    expect(resolveBuildVariant(' website ', 'play')).toBe('website')
  })

  it('ignores an override that names no variant, as a flag does', () => {
    expect(resolveBuildVariant('testflight', 'play')).toBe('play')
  })

  it('is unknown when the platform says nothing, or nothing it knows', () => {
    expect(resolveBuildVariant(undefined, null)).toBe('unknown')
    expect(resolveBuildVariant(null, 'playDebug')).toBe('unknown')
  })
})

describe('variant traits', () => {
  it('names a push service wherever a store purchase or rating prompt exists', () => {
    // A build that can sell Pro or ask for a rating is a store build, and every store build has a
    // push service: a row breaking this is more likely a typo than a new kind of build.
    for (const variant of BUILD_VARIANTS) {
      const traits = VARIANT_TRAITS[variant]
      if (traits.storePurchase !== null || traits.storeReview) {
        expect(traits.pushService, variant).not.toBeNull()
      }
    }
  })

  it('gives an unknown build none of them', () => {
    expect(VARIANT_TRAITS.unknown).toEqual({
      pushService: null,
      storePurchase: null,
      storeReview: false,
      checksForUpdates: false,
    })
  })

  it('reads the running build from its ports', () => {
    setPorts(
      memoryPorts({
        build: {
          version: '1',
          commit: null,
          buildNumber: null,
          variant: 'huawei',
          libsessionCommit: null,
        },
      }),
    )
    expect(buildTraits().pushService).toBe('huawei')
  })
})
