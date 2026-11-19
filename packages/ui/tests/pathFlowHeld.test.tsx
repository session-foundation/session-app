import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useHeldPaths, type PathFlowPath } from '#src/PathFlow'

/** A fresh array of fresh paths on each call, as the screen builds them on every poll. */
const poll = (lit: boolean, countries = ['DE', 'US', 'FI', 'DE']): PathFlowPath[] => [
  { key: 'swarm', kind: 'swarm', countries, lit },
]

describe('useHeldPaths', () => {
  it('hands back the same array while an unheld group keeps its shape', () => {
    const { result, rerender } = renderHook(({ paths }) => useHeldPaths(paths, 0, 0), {
      initialProps: { paths: poll(false) },
    })
    const first = result.current
    // Lighting a path is not a change of shape: the lit lines are drawn from the live paths.
    rerender({ paths: poll(true) })
    expect(result.current).toBe(first)
  })

  it('takes the new paths at once when an unheld group changes shape', () => {
    const { result, rerender } = renderHook(({ paths }) => useHeldPaths(paths, 0, 0), {
      initialProps: { paths: poll(false) },
    })
    const next = poll(false, ['NL', 'US', 'FI', 'DE'])
    rerender({ paths: next })
    expect(result.current).toBe(next)
  })
})
