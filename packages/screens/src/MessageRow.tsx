import type { ConversationId, Message } from '@session/client'
import { useMessage, useSessionActions } from '@session/state'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { MessageFrame, Text, XStack } from '@session/ui'
import { memo, useMemo, type ReactNode } from 'react'

import { ConversationUiContext, type ConversationUi } from './conversationUi'
import { attachmentsWidthPx } from './attachmentsWidth'
import { MessageAttachments } from './MessageAttachments'
import { useAlbumGeometry } from './useAlbumGeometry'
import { isUploadPhase } from './uploadState'

/**
 * What a send state is called on screen. Only the ones worth showing say anything.
 *
 * A function rather than a table, because `tr` reads the locale when it is called: a table built
 * at module scope would be resolved once, on import, and keep whatever locale was in use then.
 */
export function stateLabel(message: Message): string | undefined {
  switch (message.sendState) {
    case 'pending':
    case 'sending':
      return tr('sending')
    case 'uploading':
      return tr('uploading')
    // Interrupted is a send the app stopped in the middle of; to its sender it did not send, and
    // Retry resumes it as it does a failed one.
    case 'failed':
    case 'interrupted':
      return tr('messageStatusFailedToSend')
    // A file the message needs is gone, or too large to send even re-encoded, which the
    // catalogue's "Error sending file" covers. Without attachments there is no key for either
    // state, so they say nothing rather than English only.
    case 'unsendable':
      return message.attachments.length > 0 ? tr('attachmentsErrorSending') : undefined
    default:
      return undefined
  }
}

/**
 * Which states are worth offering a retry for.
 *
 * `failed` and `interrupted` are worth another attempt - something was unreachable, or a picture
 * could not be read this time. `unsendable` is not: libsession keeps it apart precisely so a client
 * knows which failures to offer a retry for, and it means a file is gone or too large to send, so
 * retrying fails identically every time.
 */
const RETRYABLE: readonly Message['sendState'][] = ['failed', 'interrupted']

/**
 * One message, read by id so an event that changes one message re-renders one row.
 *
 * `index` is the row's place in the transcript and only addresses it for tests.
 */
export const MessageRow = memo(function MessageRow({
  conversationId,
  messageId,
  index,
}: {
  conversationId: ConversationId
  messageId: number
  index: number
}) {
  const actions = useSessionActions()
  const message = useMessage(conversationId, messageId)
  const geometry = useAlbumGeometry()
  if (message === undefined) return null
  // A caption wraps at its attachments' width, so a narrow picture keeps a narrow bubble.
  const attachmentsWidth =
    message.attachments.length === 0 ? undefined : attachmentsWidthPx(message, geometry)

  const label = message.outgoing ? stateLabel(message) : undefined
  // A set still uploading has its Retry in the attachment footer, beside the count it resumes.
  const retryable =
    message.outgoing && RETRYABLE.includes(message.sendState) && !isUploadPhase(message)

  return (
    <MessageFrame
      outgoing={message.outgoing}
      alignSelf={message.outgoing ? 'flex-end' : 'flex-start'}
      // Text wraps at four fifths of the row. Attachments are sized for the transcript already,
      // as a share of it that fits the row, and their caption wraps at them.
      maxWidth={attachmentsWidth === undefined ? '80%' : '100%'}
      testID={ELEMENT.conversation.messageRow(index)}
    >
      {message.body.length === 0 ? null : (
        <Text
          size="$body"
          color={message.outgoing ? '$onAccent' : '$messageBubbleIncomingText'}
          {...(attachmentsWidth === undefined ? {} : { maxWidth: attachmentsWidth })}
          testID={ELEMENT.conversation.messageBody}
        >
          {message.body}
        </Text>
      )}
      {attachmentsWidth === undefined ? null : (
        <MessageAttachments message={message} width={attachmentsWidth} />
      )}
      {label === undefined ? null : (
        <XStack alignItems="center" gap="$xs">
          {/* On the fill, not on the page: a label only ever appears on an outgoing message. */}
          <Text
            size="$caption"
            color="$onAccentSecondary"
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
    </MessageFrame>
  )
})

const ignore = () => {}

/**
 * What a row asks of the screen around it, for rows drawn outside one: nothing they open opens.
 * For the component catalog, which draws real messages without a conversation.
 */
export function DetachedMessages({
  conversationId,
  children,
}: {
  conversationId: ConversationId
  children: ReactNode
}) {
  const ui = useMemo<ConversationUi>(
    () => ({
      conversationId,
      requestAutoDownloadPrompt: ignore,
      openViewer: ignore,
      openSheet: ignore,
    }),
    [conversationId],
  )
  return <ConversationUiContext.Provider value={ui}>{children}</ConversationUiContext.Provider>
}
