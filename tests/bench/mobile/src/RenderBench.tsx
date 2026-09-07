import { useCallback, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

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

export function RenderBench({
  conversations,
  onMounted,
}: {
  conversations: Conversation[]
  onMounted: (ms: number) => void
}) {
  // Taken before the tree is built and read once it has committed. requestAnimationFrame after a
  // commit fires once the frame carrying it has been produced, which is the closest thing to "the
  // rows are on screen" available from inside the app.
  const [start] = useState(() => Date.now())
  const report = useCallback(
    (node: unknown) => {
      if (node) requestAnimationFrame(() => onMounted(Date.now() - start))
    },
    [onMounted, start],
  )

  return (
    <ScrollView ref={report as never} style={{ flex: 1 }}>
      {conversations.map((conversation) => (
        <Row key={conversation.id} conversation={conversation} />
      ))}
    </ScrollView>
  )
}
