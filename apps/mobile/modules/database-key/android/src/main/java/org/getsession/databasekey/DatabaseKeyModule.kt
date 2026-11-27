package org.getsession.databasekey

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The database key for JavaScript; see DatabaseKeyStore, which the push service reads directly.
class DatabaseKeyModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "no React context" }

  override fun definition() = ModuleDefinition {
    Name("DatabaseKey")

    AsyncFunction("read") {
      try {
        DatabaseKeyStore.read(context)
      } catch (e: DatabaseKeyStore.Unavailable) {
        throw CodedException("ERR_KEY_UNAVAILABLE", e.message, e)
      }
    }

    AsyncFunction("write") { hex: String ->
      try {
        DatabaseKeyStore.write(context, hex)
      } catch (e: DatabaseKeyStore.Unavailable) {
        throw CodedException("ERR_KEY_UNAVAILABLE", e.message, e)
      }
    }

    AsyncFunction("clear") {
      try {
        DatabaseKeyStore.clear(context)
      } catch (e: DatabaseKeyStore.Unavailable) {
        throw CodedException("ERR_KEY_UNAVAILABLE", e.message, e)
      }
    }
  }
}
