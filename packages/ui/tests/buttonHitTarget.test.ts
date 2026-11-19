import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MIN_HIT_TARGET, buttonHeight, type ButtonSize } from '#src/buttonHitTarget'
import { SIZE_SCALE } from '#src/scales'
import { touchReach } from '#src/touchReach'

const floorSlop = (size: ButtonSize) => touchReach(buttonHeight(size), MIN_HIT_TARGET)

describe('a small button’s touch target', () => {
  it('reaches the floor however small the control is drawn', () => {
    // `xs` is an icon button drawn at the size of its glyph -- 24 tall, which is the right look and
    // a target barely half what a thumb needs. Both onboarding's back and language buttons are one.
    expect(24 + floorSlop('xs') * 2).toBe(MIN_HIT_TARGET)
    expect(32 + floorSlop('sm') * 2).toBe(MIN_HIT_TARGET)
  })

  it('adds nothing to a control that is already big enough', () => {
    expect(floorSlop('md')).toBe(0)
    expect(floorSlop('lg')).toBe(0)
  })
})

/**
 * That the height this file works from is the height the button is drawn at.
 *
 * The two live apart -- `Button`'s `size` variant sets the height, this works out what is missing
 * from it -- so a rung renamed on one side leaves the other computing slop against a height
 * nothing uses. The result is a target that is wrong only on a device, and only to a thumb.
 */
describe('the height each button size is drawn at', () => {
  it('is the token its size variant names', () => {
    const button = readFileSync(join(import.meta.dirname, '../src/Button.tsx'), 'utf8')
    const drawn = [...button.matchAll(/(xs|sm|md|lg): \{ height: '\$([\w]+)'/g)]
    expect(drawn.map((m) => m[1])).toEqual(['xs', 'sm', 'md', 'lg'])
    for (const [, size, token] of drawn) {
      expect(buttonHeight(size as ButtonSize), `${size} is drawn at $${token}`).toBe(
        SIZE_SCALE[token as keyof typeof SIZE_SCALE],
      )
    }
  })
})
