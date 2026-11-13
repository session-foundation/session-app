import type { PrimaryColorState, ThemeState } from '@session/theme-tokens'

import { DEFAULT_ACCENT, PRIMARY_COLORS, THEME_STATES } from '../themes'
import type { AnyStory } from './story'
import { STORIES } from './stories'

/** `pr` gates a pull request and stays small; `nightly` sweeps every combination, unreviewed. */
export type CatalogTier = 'pr' | 'nightly'

type CatalogPageKind = 'themes' | 'accents' | 'rtl' | 'width'

export interface CatalogPageSpec {
  id: string
  story: AnyStory
  kind: CatalogPageKind
  themes: readonly ThemeState[]
  accents: readonly PrimaryColorState[]
  rtl: boolean
  width: number
  forced: boolean
}

const PR_THEMES: readonly ThemeState[] = ['classic-dark', 'classic-light']
const PR_WIDTHS = [320, 820] as const
const NIGHTLY_WIDTHS = [320, 390, 820, 1280] as const

const storyId = (story: AnyStory) => `${story.component}-${story.story}`

function pagesFor(story: AnyStory, tier: CatalogTier): CatalogPageSpec[] {
  const id = storyId(story)
  const base = { story, rtl: false, width: story.width, forced: true }
  const { accent = false, rtl = false, responsive = false, theme = false } = story.sensitive ?? {}
  const pages: CatalogPageSpec[] = []

  if (tier === 'pr') {
    pages.push({
      ...base,
      id,
      kind: 'themes',
      themes: theme ? THEME_STATES : PR_THEMES,
      accents: [DEFAULT_ACCENT],
    })
    if (accent)
      pages.push({
        ...base,
        id: `${id}-accents`,
        kind: 'accents',
        themes: PR_THEMES,
        accents: PRIMARY_COLORS,
        forced: false,
      })
    if (rtl)
      pages.push({
        ...base,
        id: `${id}-rtl`,
        kind: 'rtl',
        themes: ['classic-light'],
        accents: [DEFAULT_ACCENT],
        rtl: true,
        forced: false,
      })
    if (responsive)
      for (const width of PR_WIDTHS)
        pages.push({
          ...base,
          id: `${id}-w${String(width)}`,
          kind: 'width',
          themes: ['classic-light'],
          accents: [DEFAULT_ACCENT],
          width,
          forced: false,
        })
    return pages
  }

  for (const shade of accent ? PRIMARY_COLORS : [DEFAULT_ACCENT])
    pages.push({
      ...base,
      id: `${id}-${shade}`,
      kind: 'themes',
      themes: THEME_STATES,
      accents: [shade],
    })
  if (rtl)
    pages.push({
      ...base,
      id: `${id}-rtl`,
      kind: 'rtl',
      themes: THEME_STATES,
      accents: [DEFAULT_ACCENT],
      rtl: true,
    })
  if (responsive)
    for (const width of NIGHTLY_WIDTHS)
      pages.push({
        ...base,
        id: `${id}-w${String(width)}`,
        kind: 'width',
        themes: THEME_STATES,
        accents: [DEFAULT_ACCENT],
        width,
      })
  return pages
}

export function catalogPages(
  tier: CatalogTier,
  stories: readonly AnyStory[] = STORIES,
): CatalogPageSpec[] {
  return stories.flatMap((story) => pagesFor(story, tier))
}

/** How many component renders a page holds: what one capture covers. */
export function cellsOn(page: CatalogPageSpec): number {
  const rows = Object.keys(page.story.variants).length
  const states = page.forced ? 1 + (page.story.forced?.length ?? 0) : 1
  return rows * states * page.themes.length * page.accents.length
}
