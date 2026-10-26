import type { Attachment, Message } from '@session/client'
import { transferKey, useMessageTransfers, useSessionActions } from '@session/state'

import { fetchOf, type Fetch } from './attachmentFetch'
import { summarise, type AttachmentSet } from './attachmentSet'
import { useConversationUi } from './conversationUi'
import { exportOne } from './exportAttachment'
import { useExportFeedback } from './useExportFeedback'

/**
 * One message's attachments as a set, and what the set's controls do.
 *
 * Reads only this message's transfers, so a report for another message does not re-render this
 * one. One record rather than a hook per attachment: a hook in a loop is fine while a message's
 * attachment list cannot change, and that is a rule nobody should have to check.
 */
export function useAttachmentSet(message: Message): {
  set: AttachmentSet
  /** One attachment's state, from the same reports the set was folded from. */
  fetchFor: (attachment: Attachment) => Fetch
  /** Fetches every attachment that is neither here nor on its way. */
  downloadMissing: () => void
  /** The footer's verb: exports the one file of a set that has arrived, else fetches the rest. */
  act: () => void
} {
  const actions = useSessionActions()
  const feedback = useExportFeedback()
  const { requestAutoDownloadPrompt } = useConversationUi()
  const transfers = useMessageTransfers(message.id)
  const reportFor = (attachment: Attachment) => transfers[transferKey('download', attachment.index)]
  const set = summarise(message, reportFor)
  const fetchFor = (attachment: Attachment) => fetchOf(attachment, reportFor(attachment))

  function downloadMissing(): void {
    // Unavailable is left out: retrying it would only fail again.
    const missing = message.attachments.filter((attachment) => {
      const state = fetchFor(attachment).state
      return state === 'idle' || state === 'failed'
    })
    if (missing.length === 0) return
    requestAutoDownloadPrompt()
    for (const attachment of missing) {
      actions
        .downloadAttachment({ messageId: message.id, index: attachment.index })
        // A refusal is recorded as a failed transfer by the store, which the set already folds in.
        .catch(() => undefined)
    }
  }

  function act(): void {
    if (set.state === 'ready') {
      // Exactly one, or the footer would not have offered this - see its `verb`.
      const only = message.attachments[0]
      if (only !== undefined) void exportOne(message, only.index, actions, feedback)
      return
    }
    downloadMissing()
  }

  return { set, fetchFor, downloadMissing, act }
}
