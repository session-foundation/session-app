/**
 * `Intl.PluralRules` for Hermes, which ships no `Intl` beyond `Collator`, `DateTimeFormat` and
 * `NumberFormat`. Every plural string is resolved through it, and without it `tr` answers with the
 * token's own name.
 *
 * The polyfill installs itself only where the engine has no working `Intl.PluralRules`. It needs
 * the rules of every language the app can be switched to, because the language can change while
 * the app runs. One file per language covers that language's regional locales (`pt-BR`, `es-419`,
 * `sr-CS`); `pt-PT` is the one region whose rules differ from its language's. `sh` and `tl` are
 * old names for `sr-Latn` and `fil`, and `kmr` is matched to `ku`.
 *
 * A locale with no rules gets those of the first file loaded, so English's comes first.
 *
 * `Intl.Locale` is polyfilled first: Hermes has none, and the plural rules' locale matcher
 * constructs one for every tag it cannot match exactly (`zh-CN`, `es-419`, `sr-CS`), throwing
 * without it.
 */
/* eslint-disable import-x/extensions -- the package exports these paths only with the extension */
import '@formatjs/intl-locale/polyfill.js'
import '@formatjs/intl-pluralrules/polyfill.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import '@formatjs/intl-pluralrules/locale-data/af.js'
import '@formatjs/intl-pluralrules/locale-data/ar.js'
import '@formatjs/intl-pluralrules/locale-data/az.js'
import '@formatjs/intl-pluralrules/locale-data/bal.js'
import '@formatjs/intl-pluralrules/locale-data/be.js'
import '@formatjs/intl-pluralrules/locale-data/bg.js'
import '@formatjs/intl-pluralrules/locale-data/bn.js'
import '@formatjs/intl-pluralrules/locale-data/ca.js'
import '@formatjs/intl-pluralrules/locale-data/cs.js'
import '@formatjs/intl-pluralrules/locale-data/cy.js'
import '@formatjs/intl-pluralrules/locale-data/da.js'
import '@formatjs/intl-pluralrules/locale-data/de.js'
import '@formatjs/intl-pluralrules/locale-data/el.js'
import '@formatjs/intl-pluralrules/locale-data/eo.js'
import '@formatjs/intl-pluralrules/locale-data/es.js'
import '@formatjs/intl-pluralrules/locale-data/et.js'
import '@formatjs/intl-pluralrules/locale-data/eu.js'
import '@formatjs/intl-pluralrules/locale-data/fa.js'
import '@formatjs/intl-pluralrules/locale-data/fi.js'
import '@formatjs/intl-pluralrules/locale-data/fil.js'
import '@formatjs/intl-pluralrules/locale-data/fr.js'
import '@formatjs/intl-pluralrules/locale-data/gl.js'
import '@formatjs/intl-pluralrules/locale-data/ha.js'
import '@formatjs/intl-pluralrules/locale-data/he.js'
import '@formatjs/intl-pluralrules/locale-data/hi.js'
import '@formatjs/intl-pluralrules/locale-data/hr.js'
import '@formatjs/intl-pluralrules/locale-data/hu.js'
import '@formatjs/intl-pluralrules/locale-data/hy.js'
import '@formatjs/intl-pluralrules/locale-data/id.js'
import '@formatjs/intl-pluralrules/locale-data/it.js'
import '@formatjs/intl-pluralrules/locale-data/ja.js'
import '@formatjs/intl-pluralrules/locale-data/ka.js'
import '@formatjs/intl-pluralrules/locale-data/km.js'
import '@formatjs/intl-pluralrules/locale-data/kn.js'
import '@formatjs/intl-pluralrules/locale-data/ko.js'
import '@formatjs/intl-pluralrules/locale-data/ku.js'
import '@formatjs/intl-pluralrules/locale-data/lg.js'
import '@formatjs/intl-pluralrules/locale-data/lo.js'
import '@formatjs/intl-pluralrules/locale-data/lt.js'
import '@formatjs/intl-pluralrules/locale-data/lv.js'
import '@formatjs/intl-pluralrules/locale-data/mk.js'
import '@formatjs/intl-pluralrules/locale-data/mn.js'
import '@formatjs/intl-pluralrules/locale-data/ms.js'
import '@formatjs/intl-pluralrules/locale-data/my.js'
import '@formatjs/intl-pluralrules/locale-data/nb.js'
import '@formatjs/intl-pluralrules/locale-data/ne.js'
import '@formatjs/intl-pluralrules/locale-data/nl.js'
import '@formatjs/intl-pluralrules/locale-data/nn.js'
import '@formatjs/intl-pluralrules/locale-data/no.js'
import '@formatjs/intl-pluralrules/locale-data/ny.js'
import '@formatjs/intl-pluralrules/locale-data/pa.js'
import '@formatjs/intl-pluralrules/locale-data/pl.js'
import '@formatjs/intl-pluralrules/locale-data/ps.js'
import '@formatjs/intl-pluralrules/locale-data/pt.js'
import '@formatjs/intl-pluralrules/locale-data/pt-PT.js'
import '@formatjs/intl-pluralrules/locale-data/ro.js'
import '@formatjs/intl-pluralrules/locale-data/ru.js'
import '@formatjs/intl-pluralrules/locale-data/si.js'
import '@formatjs/intl-pluralrules/locale-data/sk.js'
import '@formatjs/intl-pluralrules/locale-data/sl.js'
import '@formatjs/intl-pluralrules/locale-data/sq.js'
import '@formatjs/intl-pluralrules/locale-data/sr.js'
import '@formatjs/intl-pluralrules/locale-data/sv.js'
import '@formatjs/intl-pluralrules/locale-data/sw.js'
import '@formatjs/intl-pluralrules/locale-data/ta.js'
import '@formatjs/intl-pluralrules/locale-data/te.js'
import '@formatjs/intl-pluralrules/locale-data/th.js'
import '@formatjs/intl-pluralrules/locale-data/tr.js'
import '@formatjs/intl-pluralrules/locale-data/uk.js'
import '@formatjs/intl-pluralrules/locale-data/ur.js'
import '@formatjs/intl-pluralrules/locale-data/uz.js'
import '@formatjs/intl-pluralrules/locale-data/vi.js'
import '@formatjs/intl-pluralrules/locale-data/xh.js'
import '@formatjs/intl-pluralrules/locale-data/zh.js'

type PluralRulesPolyfill = {
  localeData?: Record<string, unknown>
  __addLocaleData?: (...data: { data: unknown; locale: string }[]) => void
}

/**
 * App locales the matcher cannot find a file for by name, each given its language's rules under its
 * own tag. CLDR files Traditional Chinese's rules under `zh` alone, and the matcher keeps `zh-TW`
 * (`zh-Hant`) apart from it. `sh`, `tl` and `kmr` reach `sr`, `fil` and `ku` only through CLDR's
 * language aliases, which Hermes's `Intl.getCanonicalLocales` does not apply: without these, Hermes
 * gives `tl` English's rules, and Filipino's differ.
 */
const ALIASES: Record<string, string> = { 'zh-Hant': 'zh', sh: 'sr', tl: 'fil', kmr: 'ku' }

function addAliases(): void {
  const polyfill = Intl.PluralRules as unknown as PluralRulesPolyfill
  for (const [locale, language] of Object.entries(ALIASES)) {
    const data = polyfill.localeData?.[language]
    if (data !== undefined) polyfill.__addLocaleData?.({ data, locale })
  }
}

addAliases()
