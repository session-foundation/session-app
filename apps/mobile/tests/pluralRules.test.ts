import { crowdinLocales, resetLocale, setLocale, tr } from '@session/localization'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Node has `Intl.PluralRules` and `Intl.Locale` and Hermes has neither, so both are taken away
 * here before the polyfills load, as Hermes would have it.
 */
const native = Intl.PluralRules
const nativeLocale = Intl.Locale

beforeAll(async () => {
  Reflect.deleteProperty(Intl, 'PluralRules')
  Reflect.deleteProperty(Intl, 'Locale')
  await import('#src/pluralRules')
})

afterAll(() => {
  Object.defineProperty(Intl, 'PluralRules', { value: native, configurable: true, writable: true })
  Object.defineProperty(Intl, 'Locale', { value: nativeLocale, configurable: true, writable: true })
  resetLocale()
})

describe('plural rules without the engine', () => {
  it('is installed where the engine has none', () => {
    expect(Intl.PluralRules).not.toBe(native)
    expect(typeof Intl.PluralRules).toBe('function')
  })

  it.each([
    ['ru', 2, 'few'],
    ['ru', 5, 'many'],
    ['ar', 0, 'zero'],
    ['pl', 22, 'few'],
    ['cy', 3, 'few'],
    ['pt-BR', 0, 'one'],
    ['pt-PT', 0, 'other'],
    ['zh-TW', 1, 'other'],
    ['zh-CN', 1, 'other'],
    ['es-419', 1, 'one'],
    ['sr-CS', 3, 'few'],
    ['tl', 3, 'one'],
  ] as const)('chooses %s %d as %s', (locale, count, category) => {
    expect(new Intl.PluralRules(locale).select(count)).toBe(category)
  })

  it('has the rules of every language the app can be switched to', () => {
    const matchedTo: Record<string, string> = { kmr: 'ku', sh: 'sr', tl: 'fil' }
    const language = (tag: string) => tag.split('-')[0] ?? tag
    const wrong = crowdinLocales.filter((locale) => {
      const resolved = language(new Intl.PluralRules(locale).resolvedOptions().locale)
      return resolved !== (matchedTo[locale] ?? language(locale))
    })
    expect(wrong).toEqual([])
  })

  it('falls back to English for a locale it has no rules for', () => {
    expect(new Intl.PluralRules('tlh').resolvedOptions().locale).toBe('en')
  })

  it('resolves a plural string rather than answering with its token', () => {
    setLocale('ru')
    expect(tr('deleteMessage', { count: 2 })).toBe('Удалить сообщения')
    expect(tr('deleteMessage', { count: 1 })).toBe('Удалить сообщение')
  })
})
