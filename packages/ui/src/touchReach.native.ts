import { PixelRatio } from 'react-native'

/**
 * How far a box reaches past a control drawn at `drawn`, on each side, to measure `target`: up to
 * whole pixels, since a reach of a pixel and a half and the margin that gives it back round apart
 * and move the control by one. Up, so the box is never short of `target`.
 */
export function touchReach(drawn: number, target: number): number {
  const ratio = PixelRatio.get()
  return Math.ceil(Math.max(0, (target - drawn) / 2) * ratio) / ratio
}
