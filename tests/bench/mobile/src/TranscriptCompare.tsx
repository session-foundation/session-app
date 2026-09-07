import { LegendList, type LegendListRef } from '@legendapp/list/react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'

import { makeMessages, type BenchMessage } from './messages'

/**
 * The same transcript, drawn either way, switched by hand.
 *
 * The automated run counts frames the JavaScript thread failed to produce, which is the wrong
 * instrument for the thing Legend List actually claims: cells appearing blank during a fast fling.
 * A blank cell is a frame that was produced, on time, with nothing in it - so the counter reads
 * clean while the screen looks wrong. That needs a person looking at it.
 *
 * Both sides get the same messages from the same seed, so switching compares implementations
 * rather than content. The frame counter runs continuously so a subjective impression has a number
 * beside it.
 */

const SIZES = [500, 2000, 10000] as const

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

function Choice({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: active ? '#31f196' : '#1c2122',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        flex: 1,
        alignItems: 'center',
      }}
    >
      <Text style={{ color: active ? '#0d0f10' : '#7b8781', fontWeight: '600', fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function TranscriptCompare({ onBack }: { onBack: () => void }) {
  const [implementation, setImplementation] = useState<'FlatList' | 'LegendList'>('FlatList')
  const [count, setCount] = useState<number>(2000)
  const [messages, setMessages] = useState(() => makeMessages(2000))
  const [dropped, setDropped] = useState(0)
  const [worst, setWorst] = useState(0)

  const flat = useRef<FlatList<BenchMessage> | null>(null)
  const legend = useRef<LegendListRef | null>(null)

  // Runs for as long as the screen is up, so any scroll a person does is being counted.
  useEffect(() => {
    let live = true
    let last = Date.now()
    const tick = () => {
      if (!live) return
      const now = Date.now()
      const gap = now - last
      last = now
      if (gap > 25) setDropped((n) => n + 1)
      setWorst((w) => (gap > w ? gap : w))
      requestAnimationFrame(tick)
    }
    const handle = requestAnimationFrame(tick)
    return () => {
      live = false
      cancelAnimationFrame(handle)
    }
  }, [])

  const reset = useCallback(() => {
    setDropped(0)
    setWorst(0)
  }, [])

  const choose = useCallback((next: number) => {
    setCount(next)
    setMessages(makeMessages(next))
    reset()
  }, [])

  /** A jump far past what is rendered - the harshest case for a cell that has not been filled. */
  const fling = useCallback(() => {
    const offset = 20_000 + Math.random() * 40_000
    if (implementation === 'FlatList') flat.current?.scrollToOffset({ offset, animated: true })
    else void legend.current?.scrollToOffset({ offset, animated: true })
  }, [implementation])

  const renderItem = useCallback(
    ({ item }: { item: BenchMessage }) => <Bubble message={item} />,
    [],
  )
  const keyExtractor = useCallback((item: BenchMessage) => item.id, [])

  return (
    <View style={{ flex: 1, backgroundColor: '#0d0f10', paddingTop: 56 }}>
      <View style={{ paddingHorizontal: 12, gap: 8, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Choice
            label="FlatList"
            active={implementation === 'FlatList'}
            onPress={() => {
              setImplementation('FlatList')
              reset()
            }}
          />
          <Choice
            label="Legend List"
            active={implementation === 'LegendList'}
            onPress={() => {
              setImplementation('LegendList')
              reset()
            }}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {SIZES.map((size) => (
            <Choice
              key={size}
              label={String(size)}
              active={count === size}
              onPress={() => {
                choose(size)
              }}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable
            onPress={fling}
            style={{
              backgroundColor: '#1c2122',
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 6,
            }}
          >
            <Text style={{ color: '#57c9fa', fontWeight: '600', fontSize: 13 }}>Fling</Text>
          </Pressable>
          <Pressable
            onPress={reset}
            style={{
              backgroundColor: '#1c2122',
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 6,
            }}
          >
            <Text style={{ color: '#7b8781', fontWeight: '600', fontSize: 13 }}>Reset</Text>
          </Pressable>
          <Text style={{ color: '#e7ede9', fontSize: 13, flex: 1, fontVariant: ['tabular-nums'] }}>
            dropped {dropped} · worst {worst}ms
          </Text>
          <Pressable onPress={onBack}>
            <Text style={{ color: '#7b8781', fontSize: 13 }}>Done</Text>
          </Pressable>
        </View>
      </View>

      {implementation === 'LegendList' ? (
        <LegendList
          ref={legend}
          style={{ flex: 1 }}
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          recycleItems
          estimatedItemSize={64}
        />
      ) : (
        <FlatList
          ref={flat}
          style={{ flex: 1 }}
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      )}
    </View>
  )
}
