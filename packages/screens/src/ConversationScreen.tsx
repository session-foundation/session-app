import { requirePorts } from '@session/app'
import { formatBytes, MAX_ATTACHMENTS_PER_MESSAGE } from '@session/basic-types'
import type { ConversationId, Message } from '@session/client'
import {
  useAccount,
  useAttachmentUploadLimit,
  useConversation,
  useMessage,
  useMessages,
  useSessionActions,
  type Transcript as LoadedTranscript,
} from '@session/state'
import { isolate, PENDING_COPY, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  DropOverlay,
  DropZone,
  elementMenuAnchor,
  Screen,
  ScrollToLatest,
  Text,
  TranscriptList,
  XStack,
  YStack,
  type TranscriptListHandle,
} from '@session/ui'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'

import { AttachmentSheet } from './AttachmentSheet'
import { Composer } from './Composer'
import { outgoingAttachment } from './staging'
import { useShowAfter } from './useShowAfter'
import { useStaging } from './useStaging'
import { ConversationUiContext, useConversationUi, type ConversationUi } from './conversationUi'
import { MessageMediaViewer, type ViewerTarget } from './MessageMediaViewer'
import { MessageMenu, type MessageMenuTarget } from './MessageMenu'
import { MessageRow } from './MessageRow'
import { AutoDownloadPrompt } from './AutoDownloadPrompt'
import { BackButton } from './BackButton'
import { ConversationHeader } from './ConversationHeader'
import { conversationAvatarName, conversationTitle } from './conversationTitle'
import { DateHeaderRow } from './DateHeaderRow'
import { showsDateHeader } from './dateHeaders'
import { authorName, canReply, quotedMessage, replyingToHeading } from './quotedReply'
import { TranscriptWidth } from './TranscriptWidth'

const messageKey = (message: Message) => String(message.id)

/** The messages, oldest first, each under its date where the day changes. */
function Transcript({
  conversationId,
  transcript,
  list,
  onFarFromEnd,
}: {
  conversationId: ConversationId
  transcript: LoadedTranscript
  list: Ref<TranscriptListHandle>
  onFarFromEnd: (far: boolean) => void
}) {
  const { messages, loadOlder } = transcript
  const { openMenu } = useConversationUi()
  // A row's key is its message's id; see `messageKey`.
  const openRowMenu = useCallback(
    (key: string, row: unknown) => {
      elementMenuAnchor(row, (anchor) => {
        if (anchor !== null) openMenu(Number(key), anchor)
      })
    },
    [openMenu],
  )
  return (
    // No itemHeight: a bubble is as tall as its body wraps to, so the list has to measure.
    <TranscriptList
      data={messages}
      keyExtractor={messageKey}
      onRowMenu={openRowMenu}
      handle={list}
      onStartReached={loadOlder}
      onFarFromEnd={onFarFromEnd}
      // TODO: enter on the oldest unread message once the bridge carries libsession's
      // `first_unread`; a conversation's unread count is all it gives today.
      rovingFocus="last"
      renderItem={(message, index) => (
        <YStack paddingHorizontal="$md" paddingBottom="$sm">
          {showsDateHeader(messages[index - 1], message) ? (
            <DateHeaderRow timestampMs={message.timestamp} />
          ) : null}
          <MessageRow conversationId={conversationId} messageId={message.id} index={index} />
        </YStack>
      )}
    />
  )
}

function Conversation({ conversationId }: { conversationId: ConversationId }) {
  const conversation = useConversation(conversationId)
  const account = useAccount()
  const transcript = useMessages(conversationId)
  const { messages, ready } = transcript
  const showLoading = useShowAfter(!ready)
  const actions = useSessionActions()
  const list = useRef<TranscriptListHandle | null>(null)
  const [farFromEnd, setFarFromEnd] = useState(false)
  // Held here beside the draft, not in the store: which message this screen is answering is
  // nothing another screen or device shares.
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [composerFocus, setComposerFocus] = useState(0)
  const answered = useMessage(conversationId, replyingTo?.id ?? -1) ?? replyingTo
  // The bar goes with the message it answers; what was typed stays.
  const replying = answered !== null && answered.deleted === undefined ? answered : null

  // Read by the callbacks below, which the memoised rows hold across every update.
  const held = useRef(messages)
  useLayoutEffect(() => {
    held.current = messages
  })
  const staging = useStaging((file) => actions.attachmentSendPlan(file.path, file.contentType))
  const [dropping, setDropping] = useState(false)
  const uploadLimitBytes = useAttachmentUploadLimit()
  // Unset means nobody has been asked what this conversation should fetch unprompted, which is
  // not the same as having been asked and said no. Asked once, on the first attachment fetched.
  // A request made while the conversation is still loading is held, and asked once it is known
  // to be unset.
  const [prompting, setPrompting] = useState(false)
  const autoDownload = conversation?.autoDownload
  const asking = prompting && conversation !== undefined && autoDownload === undefined
  // One viewer and one sheet for the whole transcript, so two can never be open at once.
  const [viewer, setViewer] = useState<ViewerTarget | null>(null)
  const [sheet, setSheet] = useState<number | null>(null)
  const [menu, setMenu] = useState<MessageMenuTarget | null>(null)

  // Memoised so typing in the composer does not re-render every message through the context.
  const ui = useMemo(
    (): ConversationUi => ({
      conversationId,
      requestAutoDownloadPrompt: () => {
        if (autoDownload === undefined) setPrompting(true)
      },
      openViewer: (messageId, index) => {
        setViewer({ messageId, index })
      },
      openSheet: setSheet,
      openMenu: (messageId, anchor) => {
        setMenu({ messageId, anchor })
      },
      reply: (messageId) => {
        const message = held.current.find((m) => m.id === messageId)
        if (message === undefined || !canReply(message)) return
        setReplyingTo(message)
        setComposerFocus((serial) => serial + 1)
      },
    }),
    [conversationId, autoDownload],
  )

  function toLatest(): void {
    list.current?.scrollToEnd({ animated: true })
  }

  // The id stands in for the conversation as well as for the name: opening one from a route
  // beats the store hydrating it, and a header that says nothing for a moment is a header
  // that flickers.
  const named = conversation ?? { id: conversationId }
  const title = conversationTitle(named)

  return (
    <ConversationUiContext.Provider value={ui}>
      <Screen testID={ELEMENT.conversation.screen}>
        <ConversationHeader
          id={conversationId}
          title={title}
          avatarName={conversationAvatarName(named)}
          back={<BackButton testID={ELEMENT.conversation.back} />}
        />

        <DropZone
          // Refused while a send is out, as the tray's + is: the tray is the message's until then.
          accepting={!staging.sending}
          onActive={setDropping}
          onDrop={(items, skipped) => {
            void staging.take(requirePorts().files.droppedFiles(items), skipped + items.length)
          }}
          overlay={
            // A conversation is reached only after the start that reads the limit.
            dropping && uploadLimitBytes !== null ? (
              <DropOverlay
                title={tr('attachmentsAdd')}
                hint={PENDING_COPY.attachmentsDropHint(
                  MAX_ATTACHMENTS_PER_MESSAGE,
                  isolate(formatBytes(uploadLimitBytes)),
                )}
                testID={ELEMENT.conversation.dropOverlay}
              />
            ) : undefined
          }
        >
          {ready ? (
            <TranscriptWidth flex={1}>
              <YStack flex={1} position="relative">
                <Transcript
                  conversationId={conversationId}
                  transcript={transcript}
                  list={list}
                  onFarFromEnd={setFarFromEnd}
                />
                {farFromEnd ? (
                  // A row across the transcript's foot, so the button sits at its trailing end in
                  // either direction; only the button takes a press.
                  <XStack
                    position="absolute"
                    left={0}
                    right={0}
                    bottom={0}
                    padding="$md"
                    justifyContent="flex-end"
                    pointerEvents="box-none"
                  >
                    <ScrollToLatest
                      returnsToReply={false}
                      accessibilityLabel={PENDING_COPY.messageScrollToLatest}
                      onPress={toLatest}
                      testID={ELEMENT.conversation.scrollToLatest}
                    />
                  </XStack>
                ) : null}
              </YStack>
            </TranscriptWidth>
          ) : (
            <YStack flex={1} padding="$md" alignItems="center" justifyContent="center">
              {showLoading ? <Text tone="secondary">{tr('loading')}</Text> : null}
            </YStack>
          )}

          <Composer
            staging={staging}
            reply={
              replying === null
                ? undefined
                : {
                    heading: replyingToHeading(
                      authorName(
                        replying.author,
                        account?.sessionId,
                        conversation ?? { id: conversationId },
                      ),
                    ),
                    message: quotedMessage(replying, requirePorts().media),
                  }
            }
            onCancelReply={() => {
              setReplyingTo(null)
            }}
            focusSerial={composerFocus}
            onSend={async (body, files) => {
              const { picksAreCopies } = requirePorts().files
              await actions.send(conversationId, {
                body,
                attachments: files.map((file) => outgoingAttachment(file, { picksAreCopies })),
                ...(replying === null ? {} : { replyTo: replying.id }),
              })
              // Kept through a refusal, as the draft is. A reply started while this one was out is
              // the next message's.
              setReplyingTo((current) => (current?.id === replying?.id ? null : current))
              list.current?.scrollToEnd()
            }}
          />
        </DropZone>

        <AttachmentSheet
          conversationId={conversationId}
          messageId={sheet}
          onClose={() => {
            setSheet(null)
          }}
          overlay={
            <>
              <MessageMediaViewer
                conversationId={conversationId}
                // Held back while the prompt is up: iOS presents one modal per parent at a time.
                target={asking ? null : viewer}
                onIndex={(index) => {
                  setViewer((open) => (open === null ? null : { ...open, index }))
                }}
                onClose={() => {
                  setViewer(null)
                }}
              />
              <MessageMenu
                conversationId={conversationId}
                target={menu}
                onClose={() => {
                  setMenu(null)
                }}
              />
              {conversation === undefined ? null : (
                <AutoDownloadPrompt
                  open={asking}
                  conversationId={conversationId}
                  conversationName={title}
                  onAnswered={() => {
                    setPrompting(false)
                  }}
                />
              )}
            </>
          }
        />
      </Screen>
    </ConversationUiContext.Provider>
  )
}

/**
 * One conversation: its transcript and a composer.
 *
 * The id arrives as a prop rather than being read off a route. Which router put it there is
 * the app's business, and reading it here would be the one import that pins this screen to
 * a platform again.
 */
export function ConversationScreen({ conversationId }: { conversationId: string }) {
  // A wide layout keeps this mounted and changes only the id; the key gives each conversation
  // its own draft and open overlays.
  return <Conversation key={conversationId} conversationId={conversationId} />
}
