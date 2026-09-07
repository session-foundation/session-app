import { useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native'

import type { Conversation } from './conversations'

/**
 * How long React takes to mount N conversation rows.
 *
 * Structurally the same as `ConversationListScreen`'s row - a horizontal container, a round avatar
 * with an initial, a two-line stack of name and snippet, and a conditional unread badge - drawn
 * with react-native primitives rather than through `@session/ui`. Using the real screen would drag
 * in tamagui's provider, the store, the nav port and the localisation catalogue, and the thing
 * being measured is React mounting rows, not the cost of wiring an app up.
 *
 * The same file renders in the browser through react-native-web, which is what makes the desktop
 * and device numbers comparable: same component tree, same reconciliation, different renderer.
 * That comparability is the whole point - the absolute numbers here are not the app's, the ratio
 * between platforms is.
 *
 * It renders with ScrollView and .map(), because that is what the three list screens do today.
 * Measuring a virtualised list instead would measure the fix rather than the problem.
 */

export interface RenderResult {
  rows: number
  mountMs: number
  virtualised: boolean
}

function Row({ conversation }: { conversation: Conversation }) {
  return (
    <Pressable
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: '#1c2122',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#31f196', fontSize: 15, fontWeight: '600' }}>
          {conversation.displayName.slice(0, 1).toUpperCase()}
        </Text>
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{
            color: '#e7ede9',
            fontSize: 15,
            fontWeight: conversation.unreadCount > 0 ? '700' : '400',
          }}
        >
          {conversation.displayName}
        </Text>
        <Text numberOfLines={1} style={{ color: '#7b8781', fontSize: 13 }}>
          {conversation.snippet}
        </Text>
      </View>

      {conversation.unreadCount > 0 ? (
        <View
          style={{
            backgroundColor: '#31f196',
            borderRadius: 999,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 6,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#0d0f10', fontSize: 12, fontWeight: '700' }}>
            {String(conversation.unreadCount)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

/**
 * The fixed height of a row, matching what the real conversation list passes.
 *
 * The virtualised variant supplies it as getItemLayout, which is what lets the list size its
 * scrollbar and jump to an index arithmetically rather than by measuring - the same trade as a
 * constant heightForRowAt on a table view.
 */
const ROW_HEIGHT = 64

export function RenderBench({
  conversations,
  onMounted,
  virtualised = false,
}: {
  conversations: Conversation[]
  onMounted: (ms: number) => void
  /** Draw with FlatList rather than ScrollView, which is the change being measured. */
  virtualised?: boolean
}) {
  // Taken before the tree is built and read once it has committed. requestAnimationFrame after a
  // commit fires once the frame carrying it has been produced, which is the closest thing to "the
  // rows are on screen" available from inside the app.
  //
  // An effect rather than a ref callback: react-native-web hands ScrollView's ref through a
  // different path than react-native does, and a callback ref that changes identity is invoked
  // again on every render - which on the web left this reporting nothing at all. An effect with an
  // empty dependency list fires once per mounted tree on both renderers, which is what is wanted.
  const [start] = useState(() => Date.now())
  const reported = useRef(false)

  useEffect(() => {
    if (reported.current) return
    reported.current = true
    // Whichever of the two lands first. requestAnimationFrame is the better signal - it fires
    // once the frame carrying the commit has been produced - but a browser does not run it in a
    // hidden tab, and a hidden tab is exactly where an automated run happens. The timeout is the
    // floor that keeps the run moving; the rAF is what makes the number mean "on screen".
    let done = false
    const finish = () => {
      if (done) return
      done = true
      onMounted(Date.now() - start)
    }
    const frame = requestAnimationFrame(finish)
    const timer = setTimeout(finish, 0)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
    // Once per mounted tree. onMounted and start are stable for the life of one.
  }, [])

  if (virtualised) {
    return (
      <FlatList
        style={{ flex: 1 }}
        data={conversations}
        keyExtractor={(conversation) => conversation.id}
        renderItem={({ item }) => <Row conversation={item} />}
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
      />
    )
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      {conversations.map((conversation) => (
        <Row key={conversation.id} conversation={conversation} />
      ))}
    </ScrollView>
  )
}
