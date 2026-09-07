import { LegendList, type LegendListRef } from '@legendapp/list/react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Text, View } from 'react-native'

import { sampleFrames, type FrameStats } from './FrameSampler'
import { makeMessages, type BenchMessage } from './messages'

/**
 * FlatList against Legend List on a transcript, which is the case they actually differ on.
 *
 * Both draw the same bubble component and the same messages, and neither is given a row height,
 * because a transcript genuinely has none. What is measured is a scripted scroll from the bottom of
 * the transcript to the top: how long the list takes to mount, and how many frames the JS thread
 * fails to produce while it is scrolling.
 *
 * The scroll is driven rather than performed by hand so the two runs are the same scroll. A finger
 * cannot repeat itself closely enough for a comparison this size to mean anything.
 */

// Three seconds per pass. Thirty passes at four each is two minutes of somebody holding a phone;
// three still samples roughly 180 frames, which is enough to see a difference in dropped ones.
const SCROLL_MS = 3000

function Bubble({ message }: { message: BenchMessage }) {
  return (
    <View
      style={{
        alignSelf: message.outgoing ? 'flex-end' : 'flex-start',
        backgroundColor: message.outgoing ? '#1d5c43' : '#1c2122',
        borderRadius: 16,
        marginHorizontal: 12,
        marginVertical: 3,
        maxWidth: '78%',
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: '#e7ede9', fontSize: 15, lineHeight: 20 }}>{message.body}</Text>
    </View>
  )
}

export interface TranscriptResult {
  implementation: 'FlatList' | 'LegendList'
  messages: number
  mountMs: number
  frames: number
  dropped: number
  worstGapMs: number
}

export function TranscriptBench({
  implementation,
  count,
  onDone,
}: {
  implementation: 'FlatList' | 'LegendList'
  count: number
  onDone: (result: TranscriptResult) => void
}) {
  const [messages] = useState(() => makeMessages(count))
  const [start] = useState(() => Date.now())
  const flat = useRef<FlatList<BenchMessage> | null>(null)
  const legend = useRef<LegendListRef | null>(null)
  const ran = useRef(false)

  const renderItem = useCallback(
    ({ item }: { item: BenchMessage }) => <Bubble message={item} />,
    [],
  )
  const keyExtractor = useCallback((item: BenchMessage) => item.id, [])

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const mountMs = Date.now() - start

    // Step the offset rather than using an animated scroll: an animated one is driven natively and
    // would hide exactly the JS-thread work this is trying to see.
    let offset = 0
    const step = 40
    const timer = setInterval(() => {
      offset += step
      if (implementation === 'FlatList') flat.current?.scrollToOffset({ offset, animated: false })
      else void legend.current?.scrollToOffset({ offset, animated: false })
    }, 16)

    void sampleFrames(SCROLL_MS).then((stats: FrameStats) => {
      clearInterval(timer)
      onDone({
        implementation,
        messages: count,
        mountMs,
        frames: stats.frames,
        dropped: stats.dropped,
        worstGapMs: stats.worstGapMs,
      })
    })

    return () => {
      clearInterval(timer)
    }
    // Once per mounted tree; the props do not change within one.
  }, [])

  if (implementation === 'LegendList') {
    return (
      <LegendList
        ref={legend}
        style={{ flex: 1 }}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        recycleItems
        estimatedItemSize={64}
      />
    )
  }

  return (
    <FlatList
      ref={flat}
      style={{ flex: 1 }}
      data={messages}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
    />
  )
}
