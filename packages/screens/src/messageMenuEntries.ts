import { AccountIdPrefix } from '@session/basic-types'
import type { Message } from '@session/client'
import { PENDING_COPY, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { tidyMenu, type ContextMenuEntry, type IconName } from '@session/ui'

import { offersRetry } from './messageRetry'
import { canReply } from './quotedReply'
import { isUploadPhase } from './uploadState'

/** What the menu's live entries do; the rest have nothing behind them yet. */
export interface MessageMenuActions {
  reply: () => void
  retry: () => void
  exportAttachment: (index: number) => void
  copyBody: () => void
  copyAuthor: () => void
}

/** Shown, greyed, until the feature behind each lands, so the menu keeps legacy Desktop's order. */
const NOT_BUILT = { disabled: true, onSelect: () => {} } as const

function row(
  id: string,
  label: string,
  icon: IconName,
  rest: { onSelect: () => void; disabled?: boolean; destructive?: boolean },
): ContextMenuEntry {
  return { id, kind: 'action', label, icon, testID: ELEMENT.contextMenu.item(id), ...rest }
}

/**
 * The single attachment the menu can write out, or undefined: a file still uploading or not on
 * this device has nothing to write.
 *
 * TODO: on a set, save the attachment that was pressed, as legacy Desktop does; the menu is not
 * told which one yet.
 */
function exportable(message: Message): number | undefined {
  const [only, ...rest] = message.attachments
  if (only === undefined || rest.length > 0 || isUploadPhase(message)) return undefined
  return only.availability === 'cached' ? only.index : undefined
}

/**
 * A message's context menu, in legacy Desktop's order.
 *
 * An entry that only applies to some messages is left out of the others, as legacy does: Resend
 * for a failed send, Export for attachments, Copy for a body, Copy Account ID for someone else's
 * standard account ID. An entry whose feature is not built is drawn disabled rather than hidden,
 * as Reply is on a message that cannot be answered.
 */
export function messageMenuEntries(
  message: Message,
  actions: MessageMenuActions,
): ContextMenuEntry[] {
  const exportIndex = exportable(message)
  const entries: (ContextMenuEntry | false)[] = [
    offersRetry(message) && row('retry', tr('resend'), 'rotateCw', { onSelect: actions.retry }),
    message.attachments.length > 0 &&
      row('export', PENDING_COPY.export, 'download', {
        onSelect: () => {
          if (exportIndex !== undefined) actions.exportAttachment(exportIndex)
        },
        disabled: exportIndex === undefined,
      }),
    row('reply', tr('reply'), 'reply', {
      onSelect: actions.reply,
      disabled: !canReply(message),
    }),
    message.body.length > 0 && row('copy', tr('copy'), 'copy', { onSelect: actions.copyBody }),
    row('info', tr('info'), 'info', NOT_BUILT),
    row('select', tr('select'), 'circleCheck', NOT_BUILT),
    // A community author is blinded (15, 25), and a blinded ID finds nobody.
    !message.outgoing &&
      message.author.startsWith(AccountIdPrefix.standard) &&
      row('copyAccountId', tr('accountIDCopy'), 'copy', { onSelect: actions.copyAuthor }),
    { id: 'destructive', kind: 'separator' },
    row('delete', tr('delete'), 'trash', { ...NOT_BUILT, destructive: true }),
  ]
  return tidyMenu(entries.filter((entry) => entry !== false))
}
