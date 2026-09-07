import { createElement, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { makeConversations } from './conversations'
import { RenderBench, type RenderResult } from './RenderBench'

/**
 * The render benchmark, in a browser, through react-native-web.
 *
 * This is the denominator for the device numbers. The component tree is the same file the phone
 * renders, so what differs is the renderer and the machine rather than the markup - which is the
 * only way the ratio means anything.
 *
 * react-native-web is what the desktop app itself uses, so this is also closer to the real desktop
 * cost than a hand-written DOM equivalent would be.
 */
function Harness() {
  const [results, setResults] = useState<RenderResult[]>([])
  const [rows, setRows] = useState<ReturnType<typeof makeConversations> | null>(null)
  const [pending, setPending] = useState<number[]>([])

  const onMounted = useCallback(
    (mountMs: number) => {
      setResults((done) => [...done, { rows: rows?.length ?? 0, mountMs }])
      setRows(null)
      setPending((rest) => {
        const [next, ...remaining] = rest
        if (next !== undefined) setTimeout(() => setRows(makeConversations(next)), 250)
        return remaining
      })
    },
    [rows],
  )

  const run = useCallback(() => {
    setResults([])
    const [first, ...rest] = [100, 500, 1000, 5000]
    setPending(rest)
    if (first !== undefined) setRows(makeConversations(first))
  }, [])

  if (rows) {
    return createElement(RenderBench, { conversations: rows, onMounted })
  }

  return createElement(
    'div',
    { style: { padding: 24, fontFamily: 'system-ui', color: '#e7ede9' } },
    createElement(
      'button',
      {
        onClick: run,
        style: {
          background: '#31f196',
          border: 0,
          borderRadius: 8,
          padding: '14px 20px',
          fontSize: 16,
          fontWeight: 600,
          cursor: 'pointer',
        },
      },
      'Run the render benchmark',
    ),
    createElement(
      'pre',
      { id: 'render-out', style: { marginTop: 20, fontSize: 13 } },
      results.length === 0
        ? 'Nothing measured yet.'
        : results
            .map((r) => `${String(r.rows).padStart(5)}  ${r.mountMs.toFixed(0)} ms`)
            .join('\n'),
    ),
  )
}

const host = document.getElementById('root')
if (host) createRoot(host).render(createElement(Harness))
