import { PENDING_COPY, tr } from '@session/localization'
import { Button, Spinner, Text, XStack, YStack } from '@session/ui'

import { SHOW_LOADING_AFTER_MS, useShowAfter } from './useShowAfter'

export interface PageStatusRowProps {
  state: 'loading' | 'failed'
  onRetry: () => void
  /** The spinner's while loading, Retry's once failed. */
  testID: string
}

/** A page of messages being read, or one that could not be read, with the way to ask again. */
export function PageStatusRow({ state, onRetry, testID }: PageStatusRowProps) {
  if (state === 'failed')
    return (
      <XStack padding="$md" gap="$sm" alignItems="center" justifyContent="center" flexWrap="wrap">
        <Text tone="secondary">{PENDING_COPY.messagesLoadFailed}</Text>
        <Button size="sm" variant="outline" onPress={onRetry} testID={testID}>
          {tr('retry')}
        </Button>
      </XStack>
    )
  return (
    // Named on the row: the spinner draws a progress bar of its own that takes no name.
    <YStack
      padding="$md"
      alignItems="center"
      role="status"
      aria-label={tr('loading')}
      testID={testID}
    >
      <Spinner size="small" color="$textSecondary" aria-hidden />
    </YStack>
  )
}

/**
 * What is happening past one end of a transcript: a page being read, once the read is slow enough
 * to notice, or a page that failed.
 */
export function PageStatus({
  fetching,
  waiting = false,
  failed,
  onRetry,
  loadingTestID,
  retryTestID,
}: {
  fetching: boolean
  /** The page is held back for a wait the reader sees: said at once, and on through its read. */
  waiting?: boolean | undefined
  failed: boolean
  onRetry: () => void
  loadingTestID: string
  retryTestID: string
}) {
  const slow = useShowAfter(fetching || waiting, waiting ? 0 : SHOW_LOADING_AFTER_MS)
  if (failed) return <PageStatusRow state="failed" onRetry={onRetry} testID={retryTestID} />
  if (!slow) return null
  return <PageStatusRow state="loading" onRetry={onRetry} testID={loadingTestID} />
}
