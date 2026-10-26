import { SIZE_SCALE, SPACE_SCALE } from './scales'

/**
 * The geometry of a two-member avatar, apart from the component so it can be asserted without a
 * renderer.
 *
 * The design draws it at 48: the second member a 32 disc in the top-start corner, the first a disc
 * as large again as its ring in the bottom-end corner, ringed 2 wide in the page colour so the
 * overlap reads as one disc in front of another. Other sizes keep those proportions; the ring stays
 * 2, because it is a hairline gap rather than part of the picture.
 */
const DESIGN_SIZE_PX = SIZE_SCALE['3xl']
const BACK_DESIGN_PX = SIZE_SCALE.xl

const RING_PX = SPACE_SCALE['3xs']
const FRONT_DESIGN_PX = BACK_DESIGN_PX + RING_PX

interface AvatarPairLayout {
  /** The member drawn behind. */
  backPx: number
  /** The member drawn in front, ring included. */
  frontPx: number
  ringPx: number
}

export function avatarPairLayout(sizePx: number): AvatarPairLayout {
  return {
    backPx: Math.round((sizePx * BACK_DESIGN_PX) / DESIGN_SIZE_PX),
    frontPx: Math.round((sizePx * FRONT_DESIGN_PX) / DESIGN_SIZE_PX),
    ringPx: RING_PX,
  }
}
