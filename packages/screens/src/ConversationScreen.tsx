import type { Message } from '@session/client'
import { useConversation, useMessages, useSessionActions } from '@session/state'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, Input, List, Screen, Separator, Text, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import { AttachmentRow } from './AttachmentRow'
import { AutoDownloadPrompt } from './AutoDownloadPrompt'
import { BackButton } from './BackButton'
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
  const [draft, setDraft] = useState('')
  // Unset means nobody has been asked what this conversation should fetch unprompted, which is
  // not the same as having been asked and said no. Asked once, on the first attachment tapped.
  const [prompting, setPrompting] = useState(false)
  const unasked = conversation !== undefined && conversation.autoDownload === undefined

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
        paddingHorizontal="$md"
        paddingVertical="$sm"
        gap="$sm"
        alignItems="center"
        testID={ELEMENT.conversation.header}
      >
        <BackButton testID={ELEMENT.conversation.back} />
        <Text
          size="$bodyLarge"
          weight="semibold"
          numberOfLines={1}
          testID={ELEMENT.conversation.headerName}
        >
          {title}
        </Text>
      </XStack>

      <Separator borderColor="$bordersColor" />

      {ready ? (
        // No itemHeight: a bubble is as tall as its body wraps to, so the list has to measure.
        <List
          data={messages}
          keyExtractor={(message) => String(message.id)}
          renderItem={(message, index) => (
            <YStack paddingHorizontal="$md" paddingBottom="$sm">
              <MessageRow
                message={message}
                index={index}
                onFirstDownload={unasked ? () => setPrompting(true) : undefined}
              />
            </YStack>
          )}
        />
      ) : (
        <YStack flex={1} padding="$md">
          <Text tone="secondary">{tr('loading')}</Text>
        </YStack>
      )}

      <XStack
        padding="$md"
        gap="$sm"
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

      {prompting && conversation !== undefined ? (
        <AutoDownloadPrompt
          conversationId={conversationId}
          conversationName={title}
          onAnswered={() => setPrompting(false)}
        />
      ) : null}
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

function MessageRow({
  message,
  index,
  onFirstDownload,
}: {
  message: Message
  index: number
  onFirstDownload?: (() => void) | undefined
}) {
  const actions = useSessionActions()
  const label = message.outgoing ? stateLabel(message.sendState) : undefined
  const retryable = message.outgoing && RETRYABLE.includes(message.sendState)

  return (
    <YStack
      alignSelf={message.outgoing ? 'flex-end' : 'flex-start'}
      maxWidth="80%"
      backgroundColor={message.outgoing ? '$primaryColor' : '$messageBubbleIncomingBg'}
      borderRadius="$lg"
      paddingHorizontal="$md"
      paddingVertical="$sm"
      gap="$2xs"
      testID={ELEMENT.conversation.messageRow(index)}
    >
      {message.body.length === 0 ? null : (
        <Text
          size="$body"
          color={message.outgoing ? '$onAccent' : '$messageBubbleIncomingText'}
          testID={ELEMENT.conversation.messageBody}
        >
          {message.body}
        </Text>
      )}
      {message.attachments.map((attachment) => (
        <AttachmentRow
          key={attachment.index}
          message={message}
          attachment={attachment}
          {...(onFirstDownload === undefined ? {} : { onFirstDownload })}
        />
      ))}
      {label === undefined ? null : (
        <XStack alignItems="center" gap="$xs">
          {/* On the fill, not on the page: a label only ever appears on an outgoing message, so a
              text tone would be green on green. 0.85 is the floor -- see THEMING.md on dimming an
              on-colour. */}
          <Text
            size="$caption"
            color="$onAccent"
            opacity={0.85}
            testID={ELEMENT.conversation.messageState}
          >
            {label}
          </Text>
          {retryable ? (
            <Text
              size="$caption"
              color="$onAccent"
              weight="semibold"
              textDecorationLine="underline"
              testID={ELEMENT.conversation.messageRetry}
              onPress={() => {
                // Resumes rather than restarts. The state comes back as an update, so
                // there is nothing to do here.
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
