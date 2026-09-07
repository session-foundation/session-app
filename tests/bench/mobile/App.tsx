import { useCallback, useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, StatusBar, Text, View } from 'react-native'

import { makeConversations, type Conversation } from './src/conversations'
import { RenderBench, type RenderResult } from './src/RenderBench'
import { sendRenderResults, sendResults } from './src/report'
import { runJsThreadBench, type BenchRow } from './src/run'

/**
 * The tier one benchmark, on the device it actually has to be fast on.
 *
 * Every other number in this exercise was taken on a development machine under V8, which JITs
 * aggressively and runs on silicon far quicker than a phone's. Hermes has no comparable
 * optimising tier. That multiplier is the one thing that can overturn the conclusion that the
 * serialisation is not worth removing, and it cannot be measured anywhere but here.
 *
 * Deliberately imports no native module: this measures the JavaScript half only - decode and
 * projection - so it runs in Expo Go with nothing built. The bridge half needs a dev client and
 * a signed device build, which is a separate and much larger job.
 */
export default function App() {
  const [rows, setRows] = useState<BenchRow[]>([])
  const [running, setRunning] = useState(false)
  const [sent, setSent] = useState<string>('')
  const [renderRows, setRenderRows] = useState<Conversation[] | null>(null)
  const [renderResults, setRenderResults] = useState<RenderResult[]>([])
  const [pending, setPending] = useState<number[]>([])

  // Each size is mounted as its own tree and timed on commit, then the next one starts. Rendering
  // them all at once would measure one enormous list rather than the curve.
  const onMounted = useCallback(
    (mountMs: number) => {
      setRenderResults((done) => {
        const rows = renderRows?.length ?? 0
        return [...done, { rows, mountMs }]
      })
      setRenderRows(null)
      setPending((rest) => {
        const [next, ...remaining] = rest
        if (next !== undefined) setTimeout(() => setRenderRows(makeConversations(next)), 250)
        return remaining
      })
    },
    [renderRows],
  )

  const runRender = useCallback(() => {
    setRenderResults([])
    const sizes = [100, 500, 1000, 5000]
    const [first, ...rest] = sizes
    setPending(rest)
    if (first !== undefined) setRenderRows(makeConversations(first))
  }, [])

  useEffect(() => {
    if (renderResults.length === 4 && pending.length === 0) {
      void sendRenderResults(renderResults).then(setSent)
    }
  }, [renderResults, pending])

  const run = useCallback(() => {
    setRunning(true)
    // A frame, so the button's pressed state paints before the thread is taken for seconds.
    // Without it the app looks hung, which is a poor advertisement for a benchmark about
    // the thread being blocked.
    requestAnimationFrame(() => {
      setTimeout(() => {
        const measured = runJsThreadBench()
        setRows(measured)
        setRunning(false)
        void sendResults(measured).then(setSent)
      }, 50)
    })
  }, [])

  if (renderRows) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0d0f10', paddingTop: 64 }}>
        <Text style={{ color: '#7b8781', fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 }}>
          Mounting {renderRows.length} rows...
        </Text>
        <RenderBench conversations={renderRows} onMounted={onMounted} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0d0f10', paddingTop: 64 }}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ color: '#e7ede9', fontSize: 22, fontWeight: '600', marginBottom: 4 }}>
          Session bench
        </Text>
        <Text style={{ color: '#7b8781', fontSize: 13, marginBottom: 20 }}>
          {Platform.OS} · {String(Platform.Version)} ·{' '}
          {(globalThis as { HermesInternal?: unknown }).HermesInternal ? 'Hermes' : 'JSC'}
        </Text>

        <Pressable
          onPress={run}
          disabled={running}
          style={{
            backgroundColor: running ? '#1c2122' : '#31f196',
            paddingVertical: 14,
            borderRadius: 8,
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <Text style={{ color: running ? '#7b8781' : '#0d0f10', fontWeight: '600' }}>
            {running ? 'Running…' : 'Run the benchmark'}
          </Text>
        </Pressable>

        <Pressable
          onPress={runRender}
          disabled={running}
          style={{
            backgroundColor: '#1c2122',
            paddingVertical: 14,
            borderRadius: 8,
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <Text style={{ color: '#31f196', fontWeight: '600' }}>Run the render benchmark</Text>
        </Pressable>

        {renderResults.length > 0 ? (
          <View style={{ marginBottom: 24 }}>
            <Row cells={['rows', 'mount ms']} header />
            {renderResults.map((r) => (
              <Row key={r.rows} cells={[String(r.rows), r.mountMs.toFixed(0)]} />
            ))}
          </View>
        ) : null}

        {rows.length > 0 ? (
          <View>
            <Row cells={['rows', 'KB', 'decode', 'project', 'TOTAL']} header />
            {rows.map((r) => (
              <Row
                key={r.label}
                cells={[
                  r.label,
                  r.kb.toFixed(1),
                  r.decode.toFixed(2),
                  r.project.toFixed(2),
                  r.total.toFixed(2),
                ]}
              />
            ))}
            <Text style={{ color: '#31f196', fontSize: 12, marginTop: 14 }}>
              {sent === 'sent' ? 'Results sent to the dev machine.' : sent === '' ? '' : sent}
            </Text>
            <Text style={{ color: '#7b8781', fontSize: 12, marginTop: 8, lineHeight: 18 }}>
              Milliseconds, median of the samples. Compare against the desktop run: the ratio is
              the Hermes-and-phone multiplier, and it is what decides whether the serialisation is
              worth removing from the mobile path.
            </Text>
          </View>
        ) : (
          <Text style={{ color: '#7b8781', fontSize: 14 }}>
            Nothing measured yet. The run takes a few seconds and blocks the thread while it does -
            that is the point.
          </Text>
        )}
      </ScrollView>
    </View>
  )
}

function Row({ cells, header = false }: { cells: string[]; header?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        paddingVertical: 7,
        borderBottomWidth: 1,
        borderBottomColor: '#1c2122',
      }}
    >
      {cells.map((cell, i) => (
        <Text
          key={cell + String(i)}
          style={{
            color: header ? '#7b8781' : '#e7ede9',
            fontSize: 13,
            fontVariant: ['tabular-nums'],
            flex: i === 0 ? 1.2 : 1,
            textAlign: i === 0 ? 'left' : 'right',
            fontWeight: header ? '600' : '400',
          }}
        >
          {cell}
        </Text>
      ))}
    </View>
  )
}
