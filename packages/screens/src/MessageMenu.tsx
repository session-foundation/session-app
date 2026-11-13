import type { ConversationId } from '@session/client'
import { tr } from '@session/localization'
import { useMessage, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { ContextMenu, type MenuAnchor } from '@session/ui'

import { useConversationUi } from './conversationUi'
import { exportOne } from './exportAttachment'
import { messageMenuEntries } from './messageMenuEntries'
import { useCopyWithToast } from './useCopyWithToast'
import { useExportFeedback } from './useExportFeedback'

/** Which message's menu is open, and where. */
export interface MessageMenuTarget {
  messageId: number
  anchor: MenuAnchor
}

/** The one context menu a conversation has, on whichever message asked for it. */
export function MessageMenu({
  conversationId,
  target,
  onClose,
}: {
  conversationId: ConversationId
  target: MessageMenuTarget | null
  onClose: () => void
}) {
  const actions = useSessionActions()
  const copy = useCopyWithToast()
  const feedback = useExportFeedback()
  const { reply } = useConversationUi()
  const message = useMessage(conversationId, target?.messageId ?? -1)
  // A message deleted while its menu is open closes the menu with it.
  const open = target !== null && message !== undefined
  // TODO: legacy mobile shows the message's time beside a lifted copy of its bubble; add it with
  // that copy and the reaction bar.
  return (
    <ContextMenu
      anchor={open ? target.anchor : null}
      entries={
        message === undefined
          ? []
          : messageMenuEntries(message, {
              reply: () => {
                reply(message.id)
              },
              retry: () => {
                void actions.retry(message.id)
              },
              exportAttachment: (index) => {
                void exportOne(message, index, actions, feedback)
              },
              copyBody: () => {
                copy(message.body)
              },
              copyAuthor: () => {
                copy(message.author)
              },
            })
      }
      onDismiss={onClose}
      accessibilityLabel={tr('message')}
      backLabel={tr('back')}
      testIDs={ELEMENT.contextMenu}
    />
  )
}
