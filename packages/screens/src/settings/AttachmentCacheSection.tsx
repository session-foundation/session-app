import { formatBytes } from '@session/basic-types'
import { isolate, PENDING_COPY, tr } from '@session/localization'
import { useSessionActions, type CacheSettings } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { SettingsGroup, SettingsRow, SettingsSection, Text, YStack } from '@session/ui'
import { useEffect, useState } from 'react'

function limitLabel(bytes: number | undefined): string {
  return bytes === undefined ? PENDING_COPY.attachmentCacheNoLimit : isolate(formatBytes(bytes))
}

/**
 * A figure at a row's trailing side. A size comes isolated, since on a right-to-left page its unit
 * would otherwise come before its number.
 */
function Figure({ value }: { value: string }) {
  return (
    <Text size="$label" tone="secondary">
      {value}
    </Text>
  )
}

/**
 * Where libsession keeps what it downloads, how much of the disk that takes, and its limit.
 *
 * Read-only for now. The limit is libsession's to configure, so it becomes a control once this
 * page has its own settings work.
 */
export function AttachmentCacheSection() {
  const actions = useSessionActions()
  const [settings, setSettings] = useState<CacheSettings | null>(null)

  useEffect(() => {
    let live = true
    void actions.getCacheSettings().then((read) => {
      if (live) setSettings(read)
    })
    return () => {
      live = false
    }
  }, [actions])

  return <AttachmentCacheFigures settings={settings} />
}

/** The section as it draws `settings`, or as loading while they are null. */
export function AttachmentCacheFigures({ settings }: { settings: CacheSettings | null }) {
  return (
    <YStack>
      {/* The folder as the section's description: the catalogue has no word to label it with. Empty
          against the fake, which writes nothing to disk. */}
      <SettingsSection
        label={PENDING_COPY.attachmentCache}
        {...(settings === null || settings.cacheDir.length === 0
          ? {}
          : { description: settings.cacheDir })}
      />
      <SettingsGroup>
        <SettingsRow
          label={PENDING_COPY.attachmentCacheUsage}
          trailing={
            <Figure
              value={settings === null ? tr('loading') : isolate(formatBytes(settings.usageBytes))}
            />
          }
          testID={ELEMENT.settings.cacheUsage}
        />
        <SettingsRow
          label={PENDING_COPY.attachmentCacheLimit}
          trailing={
            <Figure value={settings === null ? tr('loading') : limitLabel(settings.limitBytes)} />
          }
          testID={ELEMENT.settings.cacheLimit}
        />
      </SettingsGroup>
    </YStack>
  )
}
