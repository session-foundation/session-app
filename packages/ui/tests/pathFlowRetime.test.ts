import { describe, expect, it } from 'vitest'

import { retime } from '#src/pathFlowJourney'

const packet = (pathKey: string, startMs: number) => ({
  id: `${pathKey}-${startMs}`,
  pathKey,
  startMs,
})

describe('retime', () => {
  it('starts a request that set off before its path was drawn from when the path was drawn', () => {
    const drawn = new Map([['late', 5_000]])
    expect(retime([packet('late', 4_200)], drawn)).toEqual([
      { ...packet('late', 4_200), startMs: 5_000 },
    ])
  })

  it('leaves a request that set off after its path was drawn as it is', () => {
    const p = packet('late', 5_500)
    expect(retime([p], new Map([['late', 5_000]]))[0]).toBe(p)
  })

  it('lets a request already under way when the flow opened join part way along', () => {
    const p = packet('first', 4_200)
    expect(retime([p], new Map([['first', 0]]))[0]).toBe(p)
  })
})
