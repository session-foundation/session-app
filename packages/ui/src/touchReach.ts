/** How far a box reaches past a control drawn at `drawn`, on each side, to measure `target`. */
export function touchReach(drawn: number, target: number): number {
  return Math.max(0, (target - drawn) / 2)
}
