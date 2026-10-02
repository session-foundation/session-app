import { addTheme } from 'tamagui'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_ACCENT, DEFAULT_THEME } from '@session/theme-tokens'

import { appearanceFrom, isThemeRegistered, registerTheme } from '#src/themes'

// Only the bookkeeping is under test: what tamagui does with a theme is tamagui's, and the CSS it
// writes on the web needs a document this package's tests do not have.
vi.mock('tamagui', async (actual) => ({ ...(await actual<object>()), addTheme: vi.fn() }))

const added = () => vi.mocked(addTheme).mock.calls.map(([{ name }]) => name)

describe('registerTheme', () => {
  beforeEach(() => {
    vi.mocked(addTheme).mockClear()
  })

  it('adds nothing for the theme the configuration was created with', () => {
    expect(isThemeRegistered(DEFAULT_THEME, DEFAULT_ACCENT)).toBe(true)
    registerTheme(DEFAULT_THEME, DEFAULT_ACCENT)
    expect(added()).toEqual([])
  })

  it('adds a new theme and its accent once, and says it is there', () => {
    expect(isThemeRegistered('ocean-light', 'blue')).toBe(false)

    expect(registerTheme('ocean-light', 'blue')).toBe('oceanLight_blue')
    expect(added()).toEqual(['oceanLight', 'oceanLight_blue'])
    expect(vi.mocked(addTheme).mock.calls.every(([theme]) => theme.insertCSS === true)).toBe(true)
    expect(isThemeRegistered('ocean-light', 'blue')).toBe(true)

    registerTheme('ocean-light', 'blue')
    expect(added()).toEqual(['oceanLight', 'oceanLight_blue'])
  })

  it('adds only the accent when its base is already there', () => {
    registerTheme('ocean-light', 'blue')
    vi.mocked(addTheme).mockClear()

    registerTheme('ocean-light', 'purple')
    expect(added()).toEqual(['oceanLight_purple'])
  })
})

describe('appearanceFrom', () => {
  it('names the stored theme and accent', () => {
    expect(appearanceFrom({ theme: 'ocean-dark', accent: 'pink' })).toEqual({
      theme: 'ocean-dark',
      accent: 'pink',
    })
  })

  it('falls back per half to the default for a name this build does not ship', () => {
    expect(appearanceFrom({ theme: 'sunset-dark', accent: 'pink' })).toEqual({
      theme: DEFAULT_THEME,
      accent: 'pink',
    })
    expect(appearanceFrom(null)).toEqual({ theme: DEFAULT_THEME, accent: DEFAULT_ACCENT })
  })
})
