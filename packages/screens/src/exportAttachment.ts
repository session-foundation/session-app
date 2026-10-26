import {
  ExportAccessRefused,
  requirePorts,
  suggestedExportName,
  type ExportAccess,
} from '@session/app'
import type { Message } from '@session/client'
import type { SessionActions } from '@session/state'

/** What an export says when it does not land. Nothing is said for a cancel. */
export interface ExportFeedback {
  /** The destination needs access that was refused. */
  accessRefused: (access: ExportAccess) => void
  /** Anything else that stopped it: a refused write, a failed hand-off. */
  failed: () => void
}

/**
 * Writes one attachment out to a folder somebody chose, and shows them where it went.
 *
 * Per attachment rather than per message: a set has no "the" attachment, and a call that quietly
 * wrote the first would be worse than one that did not exist. Exporting a whole set needs a
 * directory picker `FilesPort` does not have yet, and that is its own piece of work.
 */
export async function exportOne(
  message: Message,
  index: number,
  actions: Pick<SessionActions, 'exportAttachment'>,
  feedback: ExportFeedback,
): Promise<void> {
  const attachment = message.attachments.find((a) => a.index === index)
  const suggested = suggestedExportName({
    filename: attachment?.filename,
    contentType: attachment?.contentType,
    sentAtMs: message.timestamp,
    index,
  })
  try {
    const destination = await requirePorts().files.chooseExportLocation(
      suggested,
      attachment?.contentType,
    )
    if (destination === null) return
    const saved = await actions.exportAttachment({ messageId: message.id, index }, destination)
    await requirePorts().files.revealInFolder(saved)
  } catch (error) {
    // Said here rather than by a transfer row: a refusal before the write starts (an expired
    // file, a destination refused) reaches no transfer at all.
    if (error instanceof ExportAccessRefused) feedback.accessRefused(error.access)
    else feedback.failed()
  }
}
