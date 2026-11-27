package org.getsession.push

import android.content.Context
import android.content.res.Resources

/**
 * The words a notification is made of, in the person's language.
 *
 * The app writes them from its catalogue at every launch (`setStrings`), so that a push handled
 * while it is not running still speaks the language it last spoke. Before the app has ever run,
 * they are the catalogue's for the device's language ([PushWordsGenerated]), then English.
 */
internal object PushStrings {
  private const val PREFS = "session.push.strings"

  val KEYS: Set<String> = PushWordsGenerated.ENGLISH.keys

  /** The device's language's words, by its catalogue code: see [catalogueCode]. */
  private val deviceWords: Map<String, String> by lazy {
    val locale = Resources.getSystem().configuration.locales[0]
    catalogueCode(locale.language, locale.country, locale.script)
        ?.let { PushWordsGenerated.BY_LOCALE[it]?.invoke() }
        .orEmpty()
  }

  /**
   * The catalogue's code for a device language, or null where it has none: the language with its
   * country where the catalogue has that (`pt-BR`), Chinese by its script, Latin American Spanish
   * as `es-419`, then the language alone, then the language's one regional variant.
   */
  private fun catalogueCode(language: String, country: String, script: String): String? {
    val codes = PushWordsGenerated.BY_LOCALE.keys
    val chinese =
        when {
          language != "zh" -> null
          script == "Hant" || country in setOf("TW", "HK", "MO") -> "zh-TW"
          else -> "zh-CN"
        }
    val candidates =
        listOfNotNull(
            chinese,
            "$language-$country".takeIf { country.isNotEmpty() },
            "es-419".takeIf { language == "es" && country !in setOf("", "ES") },
            language,
        )
    return candidates.firstOrNull { it in codes }
        ?: codes.singleOrNull { it.startsWith("$language-") }
  }

  fun save(context: Context, strings: Map<String, String>) {
    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    for ((key, value) in strings) if (key in KEYS) editor.putString(key, value)
    editor.apply()
  }

  fun get(context: Context, key: String): String =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, null)
          ?: deviceWords[key]
          ?: PushWordsGenerated.ENGLISH.getValue(key)
}
