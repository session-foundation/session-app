import * as SecureStore from 'expo-secure-store'

/**
 * The keychain item's name, which must not be one in `RETIRED_KEYS`: the keychain never changes an
 * existing item's accessibility on update, so only a new item gets the attribute in `OPTIONS`.
 */
const KEY = 'session.db.key.this-device'

/**
 * Names older builds stored the key under, with an accessibility that lets it into backups.
 * Deleted, never read: a key that may have been in a backup must not open anything.
 */
const RETIRED_KEYS = ['session.db.key', 'session2.database-key']

/**
 * **`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, as the legacy client keeps every keychain item.** After
 * first unlock, because a message arriving on a locked phone has to be written to the database.
 * This device only, so the key never leaves it: a backup restored to another phone carries a
 * database it cannot open. The notification extension reads the same item.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

/** iOS: the keychain. Android's store is `databaseKeyStore.android.ts`. */
export function readDatabaseKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY, OPTIONS)
}

export function writeDatabaseKey(hex: string): Promise<void> {
  return SecureStore.setItemAsync(KEY, hex, OPTIONS)
}

export function clearDatabaseKey(): Promise<void> {
  return SecureStore.deleteItemAsync(KEY, OPTIONS)
}

/** Removes what older builds stored, on a true first launch. */
export async function retireOldKeys(): Promise<void> {
  await Promise.all(RETIRED_KEYS.map((key) => SecureStore.deleteItemAsync(key)))
}
