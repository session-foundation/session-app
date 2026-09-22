import { requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Button, Text, XStack, YStack } from '@session/ui'
import { useEffect, useState } from 'react'

import { formatBytes } from './formatBytes'
import { PENDING_COPY } from './pendingCopy'

/**
 * A ladder rather than a field, because the value is bytes on disk of encrypted, padded files:
 * a number somebody typed would not bound what they thought it bounded. "No limit" is on it
 * because it is libsession's default and a real answer, not an absent one.
 */
const LIMITS: readonly (number | undefined)[] = [500_000_000, 5_000_000_000, 20_000_000_000, undefined]

/** Where libsession keeps what it downloads, and how much of the disk it may use for it. */
export function AttachmentCacheSection() {
  const actions = useSessionActions()
  const [cacheDir, setCacheDir] = useState('')
  const [limit, setLimit] = useState<number | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    void actions.getCacheSettings().then((settings) => {
      if (!live) return
      setCacheDir(settings.cacheDir)
      setLimit(settings.limit)
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [actions])

  function choose(bytes?: number): void {
    setLimit(bytes)
    void actions.setAttachmentCacheLimit(bytes)
  }

  return (
    <YStack paddingVertical="$md" gap="$xs">
      <Text tone="secondary" size="$caption">
        {PENDING_COPY.attachmentCache}
      </Text>

      {/* Empty against the fake, which writes nothing to disk. Offering to reveal a directory
          that is not there would be worse than saying nothing about it. */}
      {cacheDir.length === 0 ? null : (
        <XStack alignItems="center" gap="$sm" justifyContent="space-between">
          <Text size="$label" numberOfLines={1} flex={1} testID={ELEMENT.settings.cacheFolder}>
            {cacheDir}
          </Text>
          <Button
            variant="outline"
            size="sm"
            testID={ELEMENT.settings.cacheReveal}
            onPress={() => void requirePorts().files.revealInFolder(cacheDir)}
          >
            {PENDING_COPY.attachmentCacheReveal}
          </Button>
        </XStack>
      )}

      <Text size="$label" testID={ELEMENT.settings.cacheLimit}>
        {loaded ? limitLabel(limit) : tr('loading')}
      </Text>

      <XStack gap="$xs" flexWrap="wrap">
        {LIMITS.map((bytes) => (
          <Button
            key={bytes ?? 0}
            size="sm"
            variant={loaded && bytes === limit ? 'solid' : 'outline'}
            testID={ELEMENT.settings.cacheLimitOption(bytes ?? 0)}
            onPress={() => choose(bytes)}
          >
            {limitLabel(bytes)}
          </Button>
        ))}
      </XStack>
    </YStack>
  )
}

function limitLabel(bytes: number | undefined): string {
  return bytes === undefined ? PENDING_COPY.attachmentCacheNoLimit : formatBytes(bytes)
}
