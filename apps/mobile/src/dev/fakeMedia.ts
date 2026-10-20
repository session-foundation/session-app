import { utf8Encode } from '@session/basic-types'
import type { AttachmentRef } from '@session/client'
import { photoFileName, type FakeSessionClient } from '@session/client/fake'

/**
 * Where an export's bytes come from: the photograph for a picture, a line of text for anything
 * else.
 */
export type ExportSource = { photo: string } | { text: Uint8Array }

export function fakeExportSource(
  client: FakeSessionClient,
  ref: AttachmentRef,
  photos: ReadonlyMap<string, string>,
): ExportSource {
  const photo = photoFileName(client, ref)
  const uri = photo === null ? undefined : photos.get(photo)
  if (uri !== undefined) return { photo: uri }
  return { text: utf8Encode(`fake attachment ${String(ref.messageId)}/${String(ref.index)}\n`) }
}
