import { useNav } from '@session/app'
import type { Message } from '@session/client'
import { useConversation, useMessages, useSessionActions } from '@session/state'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, Input, List, Screen, Separator, Text, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import { conversationTitle } from './conversationTitle'

/**
 * One conversation: its transcript and a composer.
 *
 * The id arrives as a prop rather than being read off a route. Which router put it there is
 * the app's business, and reading it here would be the one import that pins this screen to
 * a platform again.
 */
export function ConversationScreen({ conversationId }: { conversationId: string }) {
  const conversation = useConversation(conversationId)
  const { messages, ready } = useMessages(conversationId)
  const actions = useSessionActions()
  const nav = useNav()
  const [draft, setDraft] = useState('')

  function send(): void {
    const body = draft.trim()
    if (body.length === 0) return
    // Cleared straight away: libsession stores the row before the promise settles, so the
    // message appears on its own and there is nothing to put back if this fails.
    setDraft('')
    void actions.send(conversationId, body)
  }

  // The id stands in for the conversation as well as for the name: opening one from a route
  // beats the store hydrating it, and a header that says nothing for a moment is a header
  // that flickers.
  const title = conversationTitle(conversation ?? { id: conversationId })

  return (
    <Screen testID={ELEMENT.conversation.screen}>
      <XStack
        paddingHorizontal="$2"
        paddingVertical="$1.5"
        gap="$1.5"
        alignItems="center"
        testID={ELEMENT.conversation.header}
      >
        <Button
          variant="ghost"
          size="sm"
          onPress={() => nav.back()}
          testID={ELEMENT.conversation.back}
        >
          {tr('back')}
        </Button>
        <Text
          size="$5"
          weight="semibold"
          numberOfLines={1}
          testID={ELEMENT.conversation.headerName}
        >
          {title}
        </Text>
      </XStack>

      <Separator borderColor="$bordersColor" />

      {ready ? (
        // No itemHeight here, unlike the conversation list: a message bubble is as tall as its
        // body wraps to, so there is nothing constant to give. The list still windows; it measures
        // rows as they come into view rather than being able to skip straight to an offset.
        <List
          data={messages}
          keyExtractor={(message) => String(message.id)}
          renderItem={(message, index) => (
            <YStack paddingHorizontal="$2" paddingBottom="$1.5">
              <MessageRow message={message} index={index} />
            </YStack>
          )}
        />
      ) : (
        <YStack flex={1} padding="$2">
          <Text tone="secondary">{tr('loading')}</Text>
        </YStack>
      )}

      <XStack
        padding="$2"
        gap="$1.5"
        alignItems="center"
        borderTopWidth={1}
        borderTopColor="$bordersColor"
      >
        <Input
          grow
          value={draft}
          onChangeText={setDraft}
          placeholder={tr('message')}
          onSubmit={send}
          testID={ELEMENT.conversation.composerInput}
        />
        <Button
          size="md"
          onPress={send}
          disabled={draft.trim().length === 0}
          testID={ELEMENT.conversation.sendButton}
        >
          {tr('send')}
        </Button>
      </XStack>
    </Screen>
  )
}

/**
 * What a send state is called on screen. Only the ones worth showing say anything.
 *
 * A function rather than a table, because `tr` reads the locale when it is called: a table built
 * at module scope would be resolved once, on import, and keep whatever locale was in use then.
 */
function stateLabel(state: Message['sendState']): string | undefined {
  switch (state) {
    case 'pending':
    case 'sending':
      return tr('sending')
    case 'uploading':
      return tr('uploading')
    case 'failed':
      return tr('messageStatusFailedToSend')
    // No catalogue entry for either of these yet, so they say nothing rather than saying it in
    // English only. `interrupted` offers a retry and `unsendable` does not, which is the part
    // that matters and is not copy.
    case 'interrupted':
    case 'unsendable':
    default:
      return undefined
  }
}

/**
 * Which states are worth offering a retry for.
 *
 * `failed` and `interrupted` are worth another attempt - something was unreachable. `unsendable`
 * is not: libsession keeps it apart precisely so a client knows which failures to offer a retry
 * for, and it means something the message needs is gone rather than merely unreachable, so
 * retrying re-reads the same missing file and fails identically every time.
 */
const RETRYABLE: readonly Message['sendState'][] = ['failed', 'interrupted']

function MessageRow({ message, index }: { message: Message; index: number }) {
  const actions = useSessionActions()
  const label = message.outgoing ? stateLabel(message.sendState) : undefined
  const retryable = message.outgoing && RETRYABLE.includes(message.sendState)

  return (
    <YStack
      alignSelf={message.outgoing ? 'flex-end' : 'flex-start'}
      maxWidth="80%"
      backgroundColor={message.outgoing ? '$messageBubbleOutgoingBg' : '$messageBubbleIncomingBg'}
      borderRadius="$3"
      paddingHorizontal="$2"
      paddingVertical="$1.5"
      gap="$0.5"
      testID={ELEMENT.conversation.messageRow(index)}
    >
      <Text
        size="$4"
        color={message.outgoing ? '$messageBubbleOutgoingText' : '$messageBubbleIncomingText'}
        testID={ELEMENT.conversation.messageBody}
      >
        {message.body}
      </Text>
      {label === undefined ? null : (
        <XStack alignItems="center" gap="$1">
          {/* Coloured like the bubble rather than by tone: a label only ever appears on an
              outgoing message, and both the secondary and the accent tone are picked to read
              against the screen - on the bubble they come out as green on green. */}
          <Text
            size="$2"
            color="$messageBubbleOutgoingText"
            opacity={0.7}
            testID={ELEMENT.conversation.messageState}
          >
            {label}
          </Text>
          {retryable ? (
            <Text
              size="$2"
              color="$messageBubbleOutgoingText"
              weight="semibold"
              textDecorationLine="underline"
              testID={ELEMENT.conversation.messageRetry}
              onPress={() => {
                // Resumes rather than restarts, so an attachment that already uploaded is not
                // sent twice. The state comes back as an update; nothing to do here.
                void actions.retry(message.id)
              }}
            >
              {tr('retry')}
            </Text>
          ) : null}
        </XStack>
      )}
    </YStack>
  )
}
