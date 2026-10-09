import { describe, expect, it } from 'vitest'

import { nativeWithoutTwin } from '#src/twins'

describe('nativeWithoutTwin', () => {
  it('reports a .native file whose plain twin is missing', () => {
    const files = new Set([
      'packages/ui/src/Screen.native.tsx',
      'packages/ui/src/Screen.tsx',
      'packages/ui/src/bodyFace.native.ts',
      'packages/ui/src/bodyFace.ts',
      'packages/ui/src/dead.native.ts',
      'packages/ui/src/Dead.tsx',
    ])
    expect(nativeWithoutTwin(files)).toEqual(['packages/ui/src/dead.native.ts'])
  })

  it('takes any extension the desktop bundle resolves as the twin', () => {
    const files = new Set(['a.native.tsx', 'a.ts', 'b.native.ts', 'b.jsx', 'c.native.ts', 'c.d.ts'])
    expect(nativeWithoutTwin(files)).toEqual(['c.native.ts'])
  })
})
