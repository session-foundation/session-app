import type { PrimaryColorState, ThemeState } from '@session/theme-tokens'
import { ELEMENT } from '@session/test-ids'
import { useEffect, useState } from 'react'
import { Theme, XStack, YStack } from 'tamagui'

import { InteractionOverride, type ForcedInteraction } from '../interactionOverride'
import { Text } from '../Text'
import { applyDirection } from '../textDirection'
import { registerTheme, themeName } from '../themes'
import type { CatalogPageSpec } from './pages'
import type { ForcedState } from './story'

const REST: ForcedInteraction = { hovered: false, pressed: false, focused: false }
const FORCED: Record<ForcedState, ForcedInteraction> = {
  hover: { hovered: true, pressed: false, focused: false },
  press: { hovered: false, pressed: true, focused: false },
  focus: { hovered: false, pressed: false, focused: true },
}

const LABEL_WIDTH = 96

const SETTLE_POLL_MS = 100
const SETTLE_TRIES = 100

/**
 * Until every picture on the page has decoded and no new one has appeared for one poll, or until
 * `signal` aborts. The polls outlive an unmounted page by up to ten seconds otherwise, and in a
 * test the next one can run after the document has been torn down.
 */
async function picturesSettled(signal: AbortSignal): Promise<void> {
  let seen = -1
  for (let attempt = 0; attempt < SETTLE_TRIES; attempt++) {
    if (signal.aborted) return
    const pictures = Array.from(document.images)
    // A source that never answers leaves `decode` pending for good, so each poll waits one round.
    const poll = new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS))
    await Promise.race([
      Promise.all(pictures.map((picture) => picture.decode().catch(() => undefined))),
      poll,
    ])
    await poll
    if (pictures.length === seen && pictures.every((picture) => picture.complete)) return
    seen = pictures.length
  }
  if (signal.aborted) return
  const pending = Array.from(document.images).filter((picture) => !picture.complete)
  console.warn(`[catalog] ${String(pending.length)} pictures never loaded`, pending[0]?.src)
}

/** Under the capture window's width, so a page of seven accents wraps rather than clips. */
const PAGE_MAX_WIDTH = 2800

interface BlockProps {
  page: CatalogPageSpec
  theme: ThemeState
  accent: PrimaryColorState
  title: string
}

/** One theme and accent: a row per variant, a column per drawn state. */
function Block({ page, theme, accent, title }: BlockProps) {
  const states = page.forced ? (page.story.forced ?? []) : []
  return (
    <Theme name={themeName(theme, accent)}>
      <YStack backgroundColor="$backgroundPrimary" padding="$md" gap="$sm">
        <Text size="$caption" tone="secondary">
          {title}
        </Text>
        {states.length === 0 ? null : (
          <XStack gap="$sm">
            <YStack width={LABEL_WIDTH} />
            {(['rest', ...states] as const).map((state) => (
              <Text key={state} size="$caption" tone="secondary" width={page.width}>
                {state}
              </Text>
            ))}
          </XStack>
        )}
        {Object.entries(page.story.variants).map(([row, props]) => (
          <XStack key={row} gap="$sm" alignItems="center">
            {/* Wrapped, and broken inside a long camelCase key, so no label is cut short. */}
            <Text
              size="$caption"
              tone="secondary"
              width={LABEL_WIDTH}
              style={{ overflowWrap: 'anywhere' }}
            >
              {row}
            </Text>
            {(['rest', ...states] as const).map((state) => (
              <InteractionOverride.Provider
                key={state}
                value={state === 'rest' ? REST : FORCED[state]}
              >
                <YStack
                  width={page.width}
                  testID={ELEMENT.catalog.cell(page.id, row, `${title}-${state}`)}
                >
                  {page.story.render(props)}
                </YStack>
              </InteractionOverride.Provider>
            ))}
          </XStack>
        ))}
      </YStack>
    </Theme>
  )
}

/**
 * Every combination a catalog page names, in one picture. Themes sit side by side; an accent page
 * puts one column per accent with each theme under it.
 */
export function CatalogPage({ page }: { page: CatalogPageSpec }) {
  // Registered before the first render: registering a theme wakes every themed component mounted.
  // The direction too, as the app sets it, since what asks `isLayoutRtl()` reads the document.
  useState(() => {
    applyDirection(page.rtl)
    for (const theme of page.themes) for (const accent of page.accents) registerTheme(theme, accent)
    return null
  })
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const unmounted = new AbortController()
    // Fonts first, then two frames: one to lay out in them, one to paint.
    void Promise.all([document.fonts.ready, picturesSettled(unmounted.signal)]).then(() => {
      if (unmounted.signal.aborted) return
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!unmounted.signal.aborted) setReady(true)
        }),
      )
    })
    return () => {
      unmounted.abort()
    }
  }, [])

  return (
    <YStack alignItems="flex-start" padding="$md" gap="$sm">
      <XStack
        testID={ELEMENT.catalog.page}
        gap="$xs"
        alignItems="flex-start"
        flexWrap="wrap"
        maxWidth={PAGE_MAX_WIDTH}
      >
        {page.kind === 'accents'
          ? page.accents.map((accent) => (
              <YStack key={accent} gap="$xs">
                {page.themes.map((theme) => (
                  <Block
                    key={theme}
                    page={page}
                    theme={theme}
                    accent={accent}
                    title={`${accent} · ${theme}`}
                  />
                ))}
              </YStack>
            ))
          : page.themes.map((theme) => (
              <Block
                key={theme}
                page={page}
                theme={theme}
                accent={page.accents[0] ?? 'green'}
                title={page.kind === 'width' ? `${theme} · ${String(page.width)}px` : theme}
              />
            ))}
      </XStack>
      {ready ? (
        <Text testID={ELEMENT.catalog.ready} size="$caption" tone="secondary">
          {page.id}
        </Text>
      ) : null}
    </YStack>
  )
}
