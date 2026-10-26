import { useCallback, useSyncExternalStore } from 'react'

import type { AttachmentView } from './attachmentView'

/**
 * Which shape each message's attachments were last asked for, keyed by message id.
 *
 * A store rather than a value in the conversation context: every message and every row under it
 * reads that context, so a choice held there redraws the whole transcript. Subscribed to per
 * message, a choice redraws the one message it is about.
 */
export interface ViewChoices {
  get: (messageId: number) => AttachmentView | undefined
  choose: (messageId: number, view: AttachmentView) => void
  subscribe: (listener: () => void) => () => void
}

export function createViewChoices(): ViewChoices {
  const chosen = new Map<number, AttachmentView>()
  const listeners = new Set<() => void>()
  return {
    get: (messageId) => chosen.get(messageId),
    choose(messageId, view) {
      if (chosen.get(messageId) === view) return
      chosen.set(messageId, view)
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** One message's choice; re-renders only when that message's choice changes. */
export function useViewChoice(choices: ViewChoices, messageId: number): AttachmentView | undefined {
  const read = useCallback(() => choices.get(messageId), [choices, messageId])
  return useSyncExternalStore(choices.subscribe, read, read)
}
