import { requirePorts, type PickedFile } from '@session/app'
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@session/basic-types'
import { isolate, PENDING_COPY, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  Announcement,
  ATTACH_OPENS_MENU,
  Button,
  ComposerNotice,
  Icon,
  Input,
  ROW_TOUCH_TARGET,
  StagedTile,
  StagedTray,
  XStack,
  YStack,
} from '@session/ui'
import { useRef, useState } from 'react'

import { AttachMenu } from './AttachMenu'
import { draftAfterSend, followSent } from './draftAfterSend'
import { refusalAnnouncement, refusalNotices } from './refusalNotices'
import { isFull, sizeOf, type StagingRefusal } from './staging'
import { NOTHING_REFUSED, type StagingState } from './useStaging'

function Notices({ staging }: { staging: StagingState }) {
  const notices = refusalNotices(staging.refused)
  return (
    <>
      <Announcement text={refusalAnnouncement(notices)} announceKey={staging.refusal} />
      {notices.map(({ kind, id, message, detail, detailName }) => (
        <ComposerNotice
          key={kind}
          message={message}
          detail={detail}
          detailName={detailName}
          dismissLabel={tr('close')}
          onDismiss={() => {
            staging.dismiss(kind)
          }}
          testID={ELEMENT.conversation.composerNotice(id)}
          dismissTestID={ELEMENT.conversation.composerNoticeDismiss(id)}
        />
      ))}
    </>
  )
}

const ATTACH_SIZE = 'md'

/** The bottom of a conversation: what is staged, what was refused, and the line being typed. */
export function Composer({
  staging,
  onSend,
}: {
  staging: StagingState
  /** Rejects when libsession refused the message, which it then has not stored. */
  onSend: (body: string, files: readonly PickedFile[]) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const picking = useRef(false)
  const outgoing = useRef<string | null>(null)
  const full = isFull(staging.files)
  const { sending, planning } = staging
  const typed = draft.trim().length > 0
  const staged = staging.files.length > 0
  // A pick still being planned holds back only a send of staged files: a message of text alone
  // goes, and the pick lands in the emptied tray after it.
  const sendable = !sending && (planning ? typed && !staged : typed || staged)

  function send(): void {
    if (!sendable) return
    const sent = draft
    const files = staging.files
    outgoing.current = sent
    // Held until libsession answers, since a refusal leaves both here to try again.
    staging.beginSend()
    onSend(sent.trim(), files).then(
      () => {
        setDraft((typed) => draftAfterSend(typed, outgoing.current))
        staging.handOff(files)
      },
      () => {
        staging.refuseSend(files.length > 0 ? 'files' : 'text')
      },
    )
  }

  function pick(which: 'files' | 'images'): void {
    // One picker at a time: a second press while one is up is refused by the system picker.
    if (picking.current) return
    picking.current = true
    const { files } = requirePorts()
    const limit = MAX_ATTACHMENTS_PER_MESSAGE - staging.files.length
    const chosen =
      which === 'images' ? files.pickImages({ multiple: true, limit }) : files.pickFiles()
    // Closed once the picker is done rather than before it opens: iOS presents the picker over the
    // menu's modal, and one presented while that modal is still dismissing never appears.
    void staging.take(chosen).finally(() => {
      picking.current = false
      setMenuOpen(false)
    })
  }

  function attach(): void {
    if (ATTACH_OPENS_MENU) setMenuOpen(true)
    else pick('files')
  }

  return (
    <YStack padding="$md" gap="$sm" borderTopWidth={1} borderTopColor="$bordersColor">
      <Notices staging={staging} />
      {staging.files.length > 0 ? (
        <StagedTray
          countLabel={PENDING_COPY.attachmentsStagedCount(
            staging.files.length,
            MAX_ATTACHMENTS_PER_MESSAGE,
          )}
          countSpokenLabel={PENDING_COPY.attachmentsStagedCountSpoken(
            staging.files.length,
            MAX_ATTACHMENTS_PER_MESSAGE,
          )}
          clearLabel={tr('clear')}
          onClear={staging.clear}
          // While a send is out, its files are the message's: neither cleared nor removed.
          clearDisabled={sending}
          addLabel={tr('attachmentsAdd')}
          onAdd={full || sending ? undefined : attach}
          testID={ELEMENT.conversation.stagedTray}
          clearTestID={ELEMENT.conversation.stagedClear}
          addTestID={ELEMENT.conversation.stagedAdd}
        >
          {staging.files.map((file, index) => {
            const size = sizeOf(file)
            return (
              <StagedTile
                key={file.path}
                name={file.name}
                contentType={file.contentType}
                // The tile sets the size in the name's direction, where a right-to-left name would
                // put the unit before the number.
                sizeLabel={size === undefined ? undefined : isolate(size)}
                previewUrl={file.previewUrl}
                label={[file.name, size].filter(Boolean).join(', ')}
                removeLabel={PENDING_COPY.attachmentRemove(file.name)}
                onRemove={() => {
                  staging.remove(file.path)
                }}
                removeDisabled={sending}
                testID={ELEMENT.conversation.stagedTile(index)}
                removeTestID={ELEMENT.conversation.stagedRemove(index)}
                previewTestID={ELEMENT.conversation.stagedPreview(index)}
              />
            )
          })}
        </StagedTray>
      ) : null}
      <XStack gap="$sm" alignItems="center">
        <Button
          variant="tonal"
          size={ATTACH_SIZE}
          circular
          disabled={full || sending}
          icon={<Icon name="plus" size="md" color="$textPrimary" />}
          accessibilityLabel={tr('attachmentsAdd')}
          touchTarget={ROW_TOUCH_TARGET}
          onPress={attach}
          testID={ELEMENT.conversation.attachButton}
        />
        <Input
          grow
          value={draft}
          onChangeText={(typed) => {
            outgoing.current = followSent(outgoing.current, typed)
            setDraft(typed)
          }}
          placeholder={tr('message')}
          onSubmit={send}
          testID={ELEMENT.conversation.composerInput}
        />
        <Button
          size="md"
          onPress={send}
          disabled={!sendable}
          testID={ELEMENT.conversation.sendButton}
        >
          {tr('send')}
        </Button>
      </XStack>
      {ATTACH_OPENS_MENU ? (
        <AttachMenu
          open={menuOpen}
          onClose={() => {
            setMenuOpen(false)
          }}
          onMedia={() => {
            pick('images')
          }}
          onDocument={() => {
            pick('files')
          }}
        />
      ) : null}
    </YStack>
  )
}

/**
 * What a detached composer holds: staged files and what was refused. Never a send in flight, which
 * lasts only until libsession stores the message and is not a state anybody sees.
 */
export interface ComposerSeed {
  files: PickedFile[]
  refused?: Partial<StagingRefusal> | undefined
}

const ignore = () => {}

/** A send that never answers, so pressing Send in the catalog changes nothing. */
const neverAnswered = () => new Promise<void>(ignore)

function seededStaging({ files, refused }: ComposerSeed): StagingState {
  return {
    files,
    refused: { ...NOTHING_REFUSED, ...refused },
    refusal: 0,
    sending: false,
    planning: false,
    beginSend: ignore,
    add: () => Promise.resolve(),
    take: () => Promise.resolve(),
    remove: ignore,
    clear: ignore,
    handOff: ignore,
    refuseSend: ignore,
    dismiss: ignore,
  }
}

/**
 * The composer holding what it is given outright rather than picked, which nothing changes and
 * nothing sends. For the component catalog, as `DetachedMessages` is for rows.
 */
export function DetachedComposer({ seed }: { seed: ComposerSeed }) {
  return <Composer staging={seededStaging(seed)} onSend={neverAnswered} />
}
