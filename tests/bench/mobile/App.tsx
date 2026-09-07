import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, StatusBar, Text, View } from 'react-native'

import { makeConversations, type Conversation } from './src/conversations'
import { RenderBench, type RenderResult } from './src/RenderBench'
import { TranscriptBench, type TranscriptResult } from './src/TranscriptBench'
import { TranscriptCompare } from './src/TranscriptCompare'
import { sendRenderResults, sendResults } from './src/report'
import { runConversionSplitBench, runJsThreadBench, type BenchRow } from './src/run'

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
  const [virtualised, setVirtualised] = useState(false)
  const [renderResults, setRenderResults] = useState<RenderResult[]>([])
  // Each entry is one pass: a size, and whether to draw it windowed. The queue runs every size
  // through both, so the before and after come from the same device in the same run.
  const [pending, setPending] = useState<{ rows: number; virtualised: boolean }[]>([])

  // FlatList against Legend List, on a transcript. Each pass mounts its own tree, scrolls it and
  // reports, then the next starts - so the two implementations see the same scroll at each size.
  const [transcript, setTranscript] = useState<{
    implementation: 'FlatList' | 'LegendList'
    count: number
  } | null>(null)
  const [transcriptResults, setTranscriptResults] = useState<TranscriptResult[]>([])
  const [transcriptQueue, setTranscriptQueue] = useState<
    { implementation: 'FlatList' | 'LegendList'; count: number }[]
  >([])
  const warmupDone = useRef(false)
  const [comparing, setComparing] = useState(false)

  const onTranscriptDone = useCallback((result: TranscriptResult) => {
    // The warm-up pass is run and thrown away; it exists to pay the JIT cost once rather than
    // charging it to whichever cell happens to go first.
    if (!warmupDone.current) {
      warmupDone.current = true
      setTranscript(null)
      setTranscriptQueue((rest) => {
        const [next, ...remaining] = rest
        if (next !== undefined) setTimeout(() => setTranscript(next), 300)
        return remaining
      })
      return
    }
    setTranscriptResults((done) => [...done, result])
    setTranscript(null)
    setTranscriptQueue((rest) => {
      const [next, ...remaining] = rest
      if (next !== undefined) setTimeout(() => setTranscript(next), 400)
      return remaining
    })
  }, [])

  const runTranscript = useCallback(() => {
    setTranscriptResults([])

    // Five repeats of every cell, shuffled, behind one discarded warm-up.
    //
    // The first version ran each cell once in a fixed order and the numbers were not usable: the
    // opening pass carried the JIT warm-up (a 50 ms mount against 10 ms for the same list later),
    // so whichever implementation went first was penalised, and a single sample could not separate
    // a real difference from run-to-run noise.
    const cells = [500, 2000, 10000].flatMap((count) => [
      { implementation: 'FlatList' as const, count },
      { implementation: 'LegendList' as const, count },
    ])

    const passes: { implementation: 'FlatList' | 'LegendList'; count: number; warmup?: boolean }[] =
      []
    for (let repeat = 0; repeat < 5; repeat++) passes.push(...cells)

    // Deterministic shuffle: the ordering has to be mixed to cancel warm-up and thermal drift, but
    // it also has to be the same mix every run or two runs are not comparable with each other.
    let seed = 20260907
    for (let i = passes.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const j = seed % (i + 1)
      const a = passes[i]
      const b = passes[j]
      if (a && b) {
        passes[i] = b
        passes[j] = a
      }
    }

    const warmup = { implementation: 'FlatList' as const, count: 2000, warmup: true }
    setTranscriptQueue(passes)
    setTranscript(warmup)
  }, [])

  // Each size is mounted as its own tree and timed on commit, then the next one starts. Rendering
  // them all at once would measure one enormous list rather than the curve.
  const onMounted = useCallback(
    (mountMs: number) => {
      const rows = renderRows?.length ?? 0
      const wasVirtualised = virtualised
      setRenderResults((done) => [...done, { rows, mountMs, virtualised: wasVirtualised }])
      setRenderRows(null)
      setPending((rest) => {
        const [next, ...remaining] = rest
        if (next !== undefined) {
          setTimeout(() => {
            setVirtualised(next.virtualised)
            setRenderRows(makeConversations(next.rows))
          }, 250)
        }
        return remaining
      })
    },
    [renderRows, virtualised],
  )

  const runRender = useCallback(() => {
    setRenderResults([])
    const passes = [100, 500, 1000, 5000].flatMap((rows) => [
      { rows, virtualised: false },
      { rows, virtualised: true },
    ])
    const [first, ...rest] = passes
    setPending(rest)
    if (first !== undefined) {
      setVirtualised(first.virtualised)
      setRenderRows(makeConversations(first.rows))
    }
  }, [])

  useEffect(() => {
    if (transcriptResults.length === 30 && transcriptQueue.length === 0) {
      // Reported per cell rather than per pass: five samples say something a single one cannot,
      // and the spread is what tells a real difference from noise.
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
      const cells = [500, 2000, 10000].flatMap((count) =>
        (['FlatList', 'LegendList'] as const).map((implementation) => {
          const runs = transcriptResults.filter(
            (r) => r.messages === count && r.implementation === implementation,
          )
          const dropped = runs.map((r) => r.dropped)
          const mounts = runs.map((r) => r.mountMs)
          const worst = runs.map((r) => r.worstGapMs)
          return {
            rows: count,
            mountMs: median(mounts),
            virtualised: implementation === 'LegendList',
            label:
              `${implementation} ${String(count)} (n=${String(runs.length)}): ` +
              `dropped ${String(median(dropped))} [${String(Math.min(...dropped))}-${String(Math.max(...dropped))}], ` +
              `mount ${median(mounts).toFixed(0)}ms, worst gap ${median(worst).toFixed(0)}ms`,
          }
        }),
      )
      void sendRenderResults(cells).then(setSent, () => setSent('failed'))
    }
    if (renderResults.length === 8 && pending.length === 0) {
      void sendRenderResults(renderResults).then(setSent)
    }
  }, [renderResults, pending, transcriptResults, transcriptQueue])

  const runSplit = useCallback(() => {
    setRunning(true)
    requestAnimationFrame(() => {
      setTimeout(() => {
        const measured = runConversionSplitBench()
        setRows(measured)
        setRunning(false)
        void sendResults(measured).then(setSent)
      }, 50)
    })
  }, [])

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

  if (comparing) {
    return (
      <TranscriptCompare
        onBack={() => {
          setComparing(false)
        }}
      />
    )
  }

  if (transcript) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0d0f10', paddingTop: 64 }}>
        <Text style={{ color: '#7b8781', fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 }}>
          {transcript.implementation} · {transcript.count} messages ·{' '}
          {String(transcriptResults.length + 1)}/30
        </Text>
        <TranscriptBench
          implementation={transcript.implementation}
          count={transcript.count}
          onDone={onTranscriptDone}
        />
      </View>
    )
  }

  if (renderRows) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0d0f10', paddingTop: 64 }}>
        <Text style={{ color: '#7b8781', fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 }}>
          Mounting {renderRows.length} rows{virtualised ? ', windowed' : ', all of them'}...
        </Text>
        <RenderBench conversations={renderRows} onMounted={onMounted} virtualised={virtualised} />
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
          onPress={runSplit}
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
            {running ? 'Running…' : 'Parse vs convert'}
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

        <Pressable
          onPress={runTranscript}
          disabled={running}
          style={{
            backgroundColor: '#1c2122',
            paddingVertical: 14,
            borderRadius: 8,
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <Text style={{ color: '#57c9fa', fontWeight: '600' }}>
            Transcript: FlatList vs Legend List (30 passes, ~2 min)
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setComparing(true)
          }}
          style={{
            backgroundColor: '#1c2122',
            paddingVertical: 14,
            borderRadius: 8,
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <Text style={{ color: '#57c9fa', fontWeight: '600' }}>
            Transcript: scroll them yourself
          </Text>
        </Pressable>

        {transcriptResults.length > 0 ? (
          <View style={{ marginBottom: 24 }}>
            <Row cells={['pass', 'list', 'msgs', 'dropped']} header />
            {transcriptResults.slice(-6).map((r, i) => (
              <Row
                key={`${r.implementation}-${String(r.messages)}-${String(i)}`}
                cells={[
                  String(transcriptResults.length - 6 + i + 1),
                  r.implementation === 'FlatList' ? 'Flat' : 'Legend',
                  String(r.messages),
                  `${String(r.dropped)}/${String(r.frames)}`,
                ]}
              />
            ))}
          </View>
        ) : null}

        {renderResults.length > 0 ? (
          <View style={{ marginBottom: 24 }}>
            <Row cells={['rows', 'draws', 'mount ms']} header />
            {renderResults.map((r) => (
              <Row
                key={`${String(r.rows)}-${String(r.virtualised)}`}
                cells={[String(r.rows), r.virtualised ? 'windowed' : 'all', r.mountMs.toFixed(0)]}
              />
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
              Milliseconds, median of the samples. Compare against the desktop run: the ratio is the
              Hermes-and-phone multiplier, and it is what decides whether the serialisation is worth
              removing from the mobile path.
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
