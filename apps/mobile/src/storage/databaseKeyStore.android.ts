import { requireNativeModule } from 'expo'

/** `modules/database-key`: the key sealed with an Android Keystore key, in no-backup storage. */
const DatabaseKey = requireNativeModule<{
  read(): Promise<string | null>
  write(hex: string): Promise<void>
}>('DatabaseKey')

/**
 * Android: the native store, which the push service also reads, with no JavaScript running, to
 * handle a push that starts the app cold. iOS keeps the keychain (`databaseKeyStore.ts`).
 */
export function readDatabaseKey(): Promise<string | null> {
  return DatabaseKey.read()
}

export function writeDatabaseKey(hex: string): Promise<void> {
  return DatabaseKey.write(hex)
}

/** Nothing to retire on Android: only development builds ever kept a key anywhere else. */
export function retireOldKeys(): Promise<void> {
  return Promise.resolve()
}
