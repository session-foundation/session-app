import { routes, useNav } from '@session/app'
import type { Conversation } from '@session/client'
import { useConversations, useUnreadRequestCount } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Avatar, List, Screen, Separator, Text, XStack, YStack } from '@session/ui'

import { conversationTitle } from './conversationTitle'

/**
 * The height of one row, which the list needs in order to place a scrollbar without measuring.
 *
 * It is `$1.5` of padding top and bottom either side of a 40px avatar - the tallest thing in the
 * row - and both text lines are `numberOfLines={1}`, so nothing here can wrap and change it. A row
 * that grew a second line would need this changed with it; `ConversationRow` is the only place
 * that could, which is why the constant lives beside it.
 */
const ROW_HEIGHT = 60

/**
 * The conversation list.
 *
 * It reads the store and navigates through the port, so it is the same screen on a phone,
 * in a tablet's left pane and in the desktop window. Which of those it is showing in is
 * AdaptiveShell's business, not its own.
 */
export function ConversationListScreen() {
  const conversations = useConversations()
  const unreadRequests = useUnreadRequestCount()
  const nav = useNav()

  return (
    <Screen testID={ELEMENT.conversationList.screen}>
      <XStack
        paddingHorizontal="$2"
        paddingVertical="$1.5"
        alignItems="center"
        justifyContent="space-between"
      >
        <Text size="$6" weight="bold">
          Messages
        </Text>
        <XStack alignItems="center" gap="$1.5">
          {unreadRequests > 0 ? (
            <XStack
              backgroundColor="$primaryColor"
              borderRadius="$full"
              paddingHorizontal="$1"
              minWidth={20}
              height={20}
              alignItems="center"
              justifyContent="center"
              testID={ELEMENT.requests.badge}
              onPress={() => nav.push(routes.requests())}
            >
              <Text size="$2" weight="bold" color="$backgroundPrimary">
                {unreadRequests}
              </Text>
            </XStack>
          ) : null}

          {/* Writing to somebody who has not written first was impossible before this: the
              only way into a conversation was replying to a request. */}
          <XStack
            width={44}
            height={44}
            alignItems="center"
            justifyContent="center"
            cursor="pointer"
            hoverStyle={{ backgroundColor: '$backgroundSecondary' }}
            pressStyle={{ backgroundColor: '$backgroundTertiary' }}
            borderRadius="$full"
            testID={ELEMENT.conversationList.newConversation}
            onPress={() => nav.push(routes.newConversation())}
          >
            <Text size="$6" tone="secondary">
              +
            </Text>
          </XStack>

          {/* Settings had a route and no way to reach it, which made the account ID - the one
              thing someone else needs in order to write to this device - unreachable too.

              The hit area is the stack rather than the glyph: a 20pt character is well under
              the 44pt minimum a finger needs, and a target that small is one people miss
              rather than one they cannot see. */}
          <XStack
            width={44}
            height={44}
            alignItems="center"
            justifyContent="center"
            cursor="pointer"
            hoverStyle={{ backgroundColor: '$backgroundSecondary' }}
            pressStyle={{ backgroundColor: '$backgroundTertiary' }}
            borderRadius="$full"
            testID={ELEMENT.conversationList.settings}
            onPress={() => nav.push(routes.settings())}
          >
            <Text size="$5" tone="secondary">
              ⚙
            </Text>
          </XStack>
        </XStack>
      </XStack>

      <Separator borderColor="$bordersColor" />

      <List
        data={conversations}
        itemHeight={ROW_HEIGHT}
        keyExtractor={(conversation) => conversation.id}
        renderItem={(conversation, index) => (
          <ConversationRow
            conversation={conversation}
            index={index}
            onPress={() => nav.push(routes.conversation(conversation.id))}
          />
        )}
        empty={
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$3">
            <Text tone="secondary" testID={ELEMENT.conversationList.empty}>
              No conversations yet
            </Text>
          </YStack>
        }
      />
    </Screen>
  )
}

function ConversationRow({
  conversation,
  index,
  onPress,
}: {
  conversation: Conversation
  index: number
  onPress: () => void
}) {
  const title = conversationTitle(conversation)

  return (
    <XStack
      height={ROW_HEIGHT}
      paddingHorizontal="$2"
      gap="$2"
      alignItems="center"
      hoverStyle={{ backgroundColor: '$backgroundSecondary' }}
      pressStyle={{ backgroundColor: '$backgroundTertiary' }}
      cursor="pointer"
      onPress={onPress}
      testID={ELEMENT.conversationList.row(index)}
    >
      <Avatar id={conversation.id} name={title} />

      <YStack flex={1} gap="$0.5">
        <Text
          size="$4"
          weight={conversation.unreadCount > 0 ? 'bold' : 'regular'}
          numberOfLines={1}
          testID={ELEMENT.conversationList.rowName}
        >
          {title}
        </Text>
        {conversation.snippet === undefined ? null : (
          <Text
            size="$3"
            tone="secondary"
            numberOfLines={1}
            testID={ELEMENT.conversationList.rowSnippet}
          >
            {conversation.snippet}
          </Text>
        )}
      </YStack>

      {conversation.unreadCount > 0 ? (
        <XStack
          backgroundColor="$primaryColor"
          borderRadius="$full"
          paddingHorizontal="$1"
          minWidth={20}
          height={20}
          alignItems="center"
          justifyContent="center"
          testID={ELEMENT.conversationList.rowUnreadBadge}
        >
          <Text size="$2" weight="bold" color="$backgroundPrimary">
            {conversation.unreadCount}
          </Text>
        </XStack>
      ) : null}
    </XStack>
  )
}
