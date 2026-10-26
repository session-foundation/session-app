import { routes, useNav } from '@session/app'
import type { Conversation } from '@session/client'
import { tr } from '@session/localization'
import { useRequests, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Avatar, Button, List, Screen, Separator, Text, XStack, YStack } from '@session/ui'

import { BackButton } from './BackButton'
import { conversationTitle } from './conversationTitle'
import { useTopBarInsets } from './shell/pane'

/**
 * One row's height, for the same reason the conversation list has one: it lets the list place a
 * scrollbar arithmetically rather than by measuring.
 *
 * A request row is a `sm` Button - 32px - inside the same padding as a conversation row, and both
 * text lines are `numberOfLines={1}`, so the avatar at 40px is still the tallest thing in it.
 */
const ROW_HEIGHT = 60

/**
 * Message requests.
 *
 * Its own screen because libsession keeps its own list: the two are disjoint, and a
 * conversation moves between them rather than gaining a flag. A stranger's first message
 * arrives here, which makes this the first place anything received from the network shows up
 * on a fresh account.
 */
export function RequestsScreen() {
  const topBarInsets = useTopBarInsets()
  const requests = useRequests()
  const nav = useNav()

  return (
    <Screen testID={ELEMENT.requests.screen}>
      <XStack
        paddingHorizontal="$md"
        paddingVertical="$sm"
        alignItems="center"
        gap="$sm"
        {...topBarInsets}
      >
        <BackButton testID={ELEMENT.requests.back} />
        <Text size="$title" weight="bold">
          {tr('sessionMessageRequests')}
        </Text>
      </XStack>

      <Separator borderColor="$bordersColor" />

      <List
        data={requests}
        itemHeight={ROW_HEIGHT}
        keyExtractor={(request) => request.id}
        renderItem={(request, index) => (
          <RequestRow
            request={request}
            index={index}
            onPress={() => nav.push(routes.conversation(request.id))}
          />
        )}
        empty={
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$xl">
            <Text tone="secondary">{tr('messageRequestsNonePending')}</Text>
          </YStack>
        }
      />
    </Screen>
  )
}

function RequestRow({
  request,
  index,
  onPress,
}: {
  request: Conversation
  index: number
  onPress: () => void
}) {
  const actions = useSessionActions()
  const title = conversationTitle(request)

  return (
    <XStack
      height={ROW_HEIGHT}
      paddingHorizontal="$md"
      gap="$md"
      alignItems="center"
      hoverStyle={{ backgroundColor: '$backgroundSecondary' }}
      pressStyle={{ backgroundColor: '$backgroundTertiary' }}
      $platform-web={{ cursor: 'pointer' }}
      onPress={onPress}
      testID={ELEMENT.requests.row(index)}
    >
      <Avatar id={request.id} name={title} />

      <YStack flex={1} gap="$2xs">
        <Text size="$body" weight="bold" numberOfLines={1}>
          {title}
        </Text>
        {request.snippet === undefined ? null : (
          <Text size="$label" tone="secondary" numberOfLines={1}>
            {request.snippet}
          </Text>
        )}
      </YStack>

      <Button
        size="sm"
        variant="outline"
        testID={ELEMENT.requests.accept(index)}
        onPress={() => {
          // Approval moves the row between the two lists rather than changing it in place, and
          // libsession sends both lists again - which is why nothing here has to update it.
          void actions.approve(request.id)
        }}
      >
        {tr('accept')}
      </Button>
    </XStack>
  )
}
