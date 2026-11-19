import { flag, requirePorts } from '@session/app'
import { formatBytes, MAX_ATTACHMENTS_PER_MESSAGE } from '@session/basic-types'
import type { ConversationId, Message } from '@session/client'
import {
  useAccount,
  useAttachmentUploadLimit,
  useConversation,
  useMessage,
  useHeldMessages,
  useMessages,
  useSessionActions,
  type Landing,
  type Transcript as LoadedTranscript,
} from '@session/state'
import { isolate, PENDING_COPY, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  DropOverlay,
  DropZone,
  elementMenuAnchor,
  LANDING_FADE_MS,
  Screen,
  ScrollToLatest,
  Text,
  TranscriptList,
  useToast,
  XStack,
  YStack,
  type TranscriptListHandle,
} from '@session/ui'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'

import { AttachmentSheet } from './AttachmentSheet'
import { Composer } from './Composer'
import { outgoingAttachment } from './staging'
import { useShowAfter } from './useShowAfter'
import { useStaging } from './useStaging'
import {
  ConversationUiContext,
  QuoteJumpContext,
  useConversationUi,
  type ConversationUi,
} from './conversationUi'
import { MessageMediaViewer, type ViewerTarget } from './MessageMediaViewer'
import { MessageMenu, type MessageMenuTarget } from './MessageMenu'
import { MessageRow } from './MessageRow'
import { AutoDownloadPrompt } from './AutoDownloadPrompt'
import { BackButton } from './BackButton'
import { ConversationHeader } from './ConversationHeader'
import { conversationAvatarName, conversationTitle } from './conversationTitle'
import { DateHeaderRow } from './DateHeaderRow'
import { PageStatus, PageStatusRow } from './PageStatus'
import { showsDateHeader } from './dateHeaders'
import {
  authorName,
  canReply,
  namer,
  originalFound,
  quotedMessage,
  replyingToHeading,
} from './quotedReply'
import { TranscriptWidth } from './TranscriptWidth'

const messageKey = (message: Message) => String(message.id)

/** One toast however often it is asked for: a second press shows it again, not twice. */
const ORIGINAL_NOT_FOUND_TOAST = 'original-not-found'

/**
 * How many list heights from the newest message the button still scrolls there. Further, it reads
 * the newest page in afresh, as Telegram does: scrolling through the pages between is slow and
 * keeps them all held.
 */
const LATEST_ANIMATED_VIEWPORTS = 3

/** How long a landing's highlight stays mounted: its fade, and a margin for the frames around. */
const HIGHLIGHT_HOLD_MS = LANDING_FADE_MS + 400

/** The messages, oldest first, each under its date where the day changes. */
function Transcript({
  conversationId,
  transcript,
  highlight,
  held,
  list,
  onFarFromEnd,
  showsOnceAtEnd,
  onAtEnd,
  onRowsOnScreen,
}: {
  conversationId: ConversationId
  transcript: LoadedTranscript
  /** The landing being shown, on the row it landed on. */
  highlight: Landing | null
  /** Draws the landing's highlight at full strength, with no fade. */
  held: boolean
  list: Ref<TranscriptListHandle>
  onFarFromEnd: (far: boolean) => void
  /** See `TranscriptListProps.showsOnceAtEnd`. */
  showsOnceAtEnd?: boolean | undefined
  onAtEnd: () => void
  onRowsOnScreen: (keys: ReadonlySet<string>) => void
}) {
  const {
    messages,
    hasOlder,
    hasNewer,
    loadOlder,
    loadNewer,
    fetchingOlder,
    olderPageFailed,
    fetchingNewer,
    newerPageFailed,
  } = transcript
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
      moreBefore={hasOlder}
      onEndReached={loadNewer}
      moreAfter={hasNewer}
      onFarFromEnd={onFarFromEnd}
      showsOnceAtEnd={showsOnceAtEnd}
      onAtEnd={onAtEnd}
      onRowsOnScreen={onRowsOnScreen}
      header={
        <PageStatus
          fetching={fetchingOlder}
          failed={olderPageFailed}
          onRetry={loadOlder}
          loadingTestID={ELEMENT.conversation.olderPageLoading}
          retryTestID={ELEMENT.conversation.olderPageRetry}
        />
      }
      footer={
        <PageStatus
          fetching={fetchingNewer}
          failed={newerPageFailed}
          onRetry={loadNewer}
          loadingTestID={ELEMENT.conversation.newerPageLoading}
          retryTestID={ELEMENT.conversation.newerPageRetry}
        />
      }
      // TODO: enter on the oldest unread message once the bridge carries libsession's
      // `first_unread`; a conversation's unread count is all it gives today.
      rovingFocus="last"
      renderItem={(message, index) => (
        <YStack paddingHorizontal="$md" paddingBottom="$sm">
          {showsDateHeader(messages[index - 1], message) ? (
            <DateHeaderRow timestampMs={message.timestamp} />
          ) : null}
          <MessageRow
            conversationId={conversationId}
            messageId={message.id}
            index={index}
            highlightSerial={highlight?.messageId === message.id ? highlight.serial : undefined}
            highlightHeld={held && highlight?.messageId === message.id}
          />
        </YStack>
      )}
    />
  )
}

/**
 * Scrolls to each landing a jump makes, and shows its highlight once the list has stopped there:
 * started with the scroll, most of the fade is spent before the message is seen. The highlight is
 * kept only for as long as the fade takes, so a row drawn again later does not replay it.
 */
function useLanding(
  transcript: LoadedTranscript,
  list: { current: TranscriptListHandle | null },
): Landing | null {
  const { landing, messages } = transcript
  const [highlight, setHighlight] = useState<Landing | null>(null)
  const shownSerial = useRef<number | undefined>(undefined)
  /** The messages the list held before this render, which a landing among may be animated to. */
  const heldBefore = useRef<ReadonlySet<number>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useLayoutEffect(() => {
    if (landing !== undefined && landing.serial !== shownSerial.current) {
      shownSerial.current = landing.serial
      list.current?.scrollToKey(String(landing.messageId), {
        animated: heldBefore.current.has(landing.messageId),
        focus: true,
        onArrived: () => {
          // A later landing has taken over.
          if (shownSerial.current !== landing.serial) return
          setHighlight(landing)
          // Held still, it stays until the next landing.
          if (flag('disableAnimations')) return
          clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            setHighlight(null)
          }, HIGHLIGHT_HOLD_MS)
        },
      })
    }
    heldBefore.current = new Set(messages.map((m) => m.id))
  }, [landing, messages, list])

  useEffect(
    () => () => {
      clearTimeout(timer.current)
    },
    [],
  )
  return highlight
}

const ignore = () => undefined

/**
 * The transcript just after a jump landed on `landedOn`, its highlight held: for the component
 * catalog, whose capture would otherwise catch the fade at a moment of its own. Scrolls the list
 * there without moving the store's window, which the catalog's other rows draw from.
 */
export function DetachedTranscript({
  conversationId,
  landedOn,
}: {
  conversationId: ConversationId
  landedOn: number
}) {
  // Not `useMessages`, which forgets the history when this goes, under the catalog's other rows.
  const transcript = useHeldMessages(conversationId)
  const list = useRef<TranscriptListHandle | null>(null)
  const [highlight, setHighlight] = useState<Landing | null>(null)
  useLayoutEffect(() => {
    if (!transcript.ready) return
    list.current?.scrollToKey(String(landedOn), {
      onArrived: () => {
        setHighlight({ messageId: landedOn, serial: 1 })
      },
    })
  }, [transcript.ready, landedOn])
  if (!transcript.ready) return null
  return (
    <Transcript
      conversationId={conversationId}
      transcript={transcript}
      highlight={highlight}
      held
      list={list}
      onFarFromEnd={ignore}
      onAtEnd={ignore}
      onRowsOnScreen={ignore}
    />
  )
}

function Conversation({ conversationId }: { conversationId: ConversationId }) {
  const conversation = useConversation(conversationId)
  const account = useAccount()
  const transcript = useMessages(conversationId)
  const { messages, ready, firstPageFailed, reload } = transcript
  const showLoading = useShowAfter(!ready && !firstPageFailed)
  const actions = useSessionActions()
  const toasts = useToast()
  const list = useRef<TranscriptListHandle | null>(null)
  const highlight = useLanding(transcript, list)
  const [farFromEnd, setFarFromEnd] = useState(false)
  // Bumped to draw the transcript afresh, as when it opens: every row on the first pass, shown
  // once at its end. Swapping a whole window under a list that stays mounted, Android's
  // place-keeping and the list's following of its end pull against each other as rows measure.
  const [listEpoch, setListEpoch] = useState(0)
  // The first message of the window the newest page is replacing, while it is read. The new
  // window is drawn by a new list in the very render it arrives in: a frame of it in the old one
  // shows its top.
  const [reloadingFrom, setReloadingFrom] = useState<number | null>(null)
  const firstHeld = transcript.messages[0]?.id
  const reloaded = reloadingFrom !== null && firstHeld !== reloadingFrom
  const listKey = listEpoch + (reloaded ? 1 : 0)
  // The read is over: set once it answers, so the render that sees it holds what it read.
  const [reloadAnswered, setReloadAnswered] = useState(false)
  useEffect(() => {
    if (reloaded) {
      // A new list says only what changes, and starts at its end.
      setFarFromEnd(false)
      setListEpoch((epoch) => epoch + 1)
    } else if (reloadAnswered && reloadingFrom !== null) {
      // The newest page began where the window did: no new list, only the way to its end.
      list.current?.scrollToEnd({ animated: false })
    } else return
    setReloadingFrom(null)
    setReloadAnswered(false)
  }, [reloaded, reloadAnswered, reloadingFrom])
  // Held here beside the draft, not in the store: which message this screen is answering is
  // nothing another screen or device shares. As it was when the reply started, for when a jump
  // has taken it out of the window.
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [composerFocus, setComposerFocus] = useState(0)
  const [followingQuoteOf, setFollowingQuoteOf] = useState<number | null>(null)
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

  // On the names alone: the conversation itself changes with every message it receives.
  const ownId = account?.sessionId
  const nickname = conversation?.nickname
  const displayName = conversation?.displayName
  const nameOf = useMemo(
    () => namer(ownId, { id: conversationId, nickname, displayName }),
    [ownId, conversationId, nickname, displayName],
  )

  // Memoised so typing in the composer does not re-render every message through the context.
  const ui = useMemo(
    (): ConversationUi => ({
      conversationId,
      nameOf,
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
      openQuote: (replyId) => {
        const reply = held.current.find((m) => m.id === replyId)?.replyTo
        if (reply === undefined) return
        const notFound = () => {
          toasts.show(tr('messageErrorOriginal'), { id: ORIGINAL_NOT_FOUND_TOAST })
        }
        if (!originalFound(reply)) {
          notFound()
          return
        }
        // Busy only while the original is read in: one in the window arrives at once, and the
        // spinner would take its quote's picture away for a frame.
        if (!held.current.some((m) => m.id === reply.messageId)) setFollowingQuoteOf(replyId)
        // An original already on screen is only shown, with nowhere to come back from.
        const inPlace = list.current?.isOnScreen(String(reply.messageId)) === true
        actions
          .jumpToMessage(conversationId, reply.messageId, inPlace ? undefined : replyId)
          .then((outcome) => {
            // Overtaken by a later jump, it lands nowhere and nothing is missing.
            if (outcome === 'absent') notFound()
          }, notFound)
          .finally(() => {
            setFollowingQuoteOf((following) => (following === replyId ? null : following))
          })
      },
    }),
    [conversationId, autoDownload, actions, toasts, nameOf],
  )

  // Shown by where the reader is alone: a jump to return from changes what a press does, never
  // whether there is a button.
  const offersLatest = transcript.hasNewer || farFromEnd
  const returnsToReply = transcript.jumpCount > 0
  // Back at the newest message, the detour is over.
  const offered = useRef(offersLatest)
  useEffect(() => {
    if (offered.current && !offersLatest) actions.forgetJumps(conversationId, 'all')
    offered.current = offersLatest
  }, [offersLatest, actions, conversationId])

  // A reply scrolled back to by hand is no longer somewhere to return to. Only once it has been
  // off screen: at the press, the reply is the row under the pointer.
  const { returnsTo } = transcript
  const leftBehind = useRef<number | undefined>(undefined)
  const followRows = useCallback(
    (keys: ReadonlySet<string>) => {
      if (returnsTo === undefined) leftBehind.current = undefined
      else if (!keys.has(String(returnsTo))) leftBehind.current = returnsTo
      else if (leftBehind.current === returnsTo) {
        leftBehind.current = undefined
        actions.forgetJumps(conversationId, 'latest')
      }
    },
    [returnsTo, actions, conversationId],
  )
  // Reached by scrolling, with no button shown on the way, the newest message ends the detour too.
  const { hasNewer } = transcript
  const reachedEnd = useCallback(() => {
    if (!hasNewer) actions.forgetJumps(conversationId, 'all')
  }, [hasNewer, actions, conversationId])

  // A read that fails leaves the button as it was, to press again; the store logs it.
  function toLatest(): void {
    if (returnsToReply) {
      actions.returnFromJump(conversationId).catch(() => undefined)
      return
    }
    const nearby =
      !transcript.hasNewer && (list.current?.viewportsFromEnd() ?? 0) <= LATEST_ANIMATED_VIEWPORTS
    if (nearby) {
      list.current?.scrollToEnd({ animated: true })
      return
    }
    // Read in afresh, the newest page is simply where the list is put: nothing to animate from,
    // and the pages above it are dropped rather than scrolled through.
    setReloadingFrom(transcript.messages[0]?.id ?? null)
    setReloadAnswered(false)
    actions.showNewest(conversationId, { evenWhenHeld: true }).then(
      () => {
        setReloadAnswered(true)
      },
      () => {
        setReloadingFrom(null)
      },
    )
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
                <QuoteJumpContext.Provider value={followingQuoteOf}>
                  <Transcript
                    key={listKey}
                    // Drawn afresh in place, with no screen sliding over it.
                    showsOnceAtEnd={listKey > 0}
                    conversationId={conversationId}
                    transcript={transcript}
                    // With animations off, for tests that would race the fade, it is held.
                    held={flag('disableAnimations')}
                    highlight={highlight}
                    list={list}
                    onFarFromEnd={setFarFromEnd}
                    onAtEnd={reachedEnd}
                    onRowsOnScreen={followRows}
                  />
                </QuoteJumpContext.Provider>
                {offersLatest ? (
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
                      returnsToReply={returnsToReply}
                      accessibilityLabel={
                        returnsToReply
                          ? PENDING_COPY.messageBackToReply
                          : PENDING_COPY.messageScrollToLatest
                      }
                      onPress={toLatest}
                      testID={ELEMENT.conversation.scrollToLatest}
                    />
                  </XStack>
                ) : null}
              </YStack>
            </TranscriptWidth>
          ) : (
            <YStack flex={1} padding="$md" alignItems="center" justifyContent="center">
              {firstPageFailed ? (
                <PageStatusRow
                  state="failed"
                  onRetry={reload}
                  testID={ELEMENT.conversation.firstPageRetry}
                />
              ) : showLoading ? (
                <Text tone="secondary">{tr('loading')}</Text>
              ) : null}
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
              // Kept through a refusal, as the draft is; the store has shown the newest page. A
              // reply started while this one was out is the next message's.
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
