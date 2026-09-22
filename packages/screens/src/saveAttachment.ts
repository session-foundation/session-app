import { requirePorts } from '@session/app'
import type { Message } from '@session/client'
import type { useSessionActions } from '@session/state'

/**
 * Writes one attachment out to a folder somebody chose, and shows them where it went.
 *
 * Per attachment rather than per message: a set has no "the" attachment, and a call that quietly
 * wrote the first would be worse than one that did not exist. Saving a whole set needs a directory
 * picker `FilesPort` does not have yet, and that is its own piece of work.
 */
export async function saveOne(
  message: Message,
  index: number,
  actions: ReturnType<typeof useSessionActions>,
): Promise<void> {
  const attachment = message.attachments.find((a) => a.index === index)
  const suggested = attachment?.filename ?? `attachment-${String(index + 1)}`
  const destination = await requirePorts().files.chooseSaveLocation(suggested)
  if (destination === null) return
  const saved = await actions.saveAttachment(message.id, index, destination)
  await requirePorts().files.revealInFolder(saved)
}
