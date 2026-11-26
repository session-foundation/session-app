import { keyInvalid, keyMissing, keyUnavailable } from '@session/client'
import * as Crypto from 'expo-crypto'

import {
  clearDatabaseKey,
  readDatabaseKey,
  retireOldKeys,
  writeDatabaseKey,
} from './databaseKeyStore'

export { readDatabaseKey, writeDatabaseKey }

/** What the bridge takes: 32 bytes as 64 hex characters. */
const HEX_KEY = /^[0-9a-f]{64}$/i

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A new random key, stored, as hex. */
async function mintDatabaseKey(): Promise<string> {
  const bytes = Crypto.getRandomBytes(32)
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  await writeDatabaseKey(hex)
  return hex
}

/**
 * The database key.
 *
 * libsession accepts a key but neither derives nor stores one, so custody is the app's. A random
 * 32 bytes at first launch, kept in the OS keychain - which is the entire reason there is a
 * secure-storage port at all.
 *
 * **A key is made only when there is none and no database either.** A missing key beside a
 * database may be lost, or on Android may be a Keystore that cannot be reached right now, which
 * some versions report as no key; minting would make the database unreadable for good either way.
 * It is thrown as `KEY_MISSING` instead, nothing is deleted, and clearing past it is the person's
 * choice on the startup-failure screen. A read that throws is a keychain that will not answer now
 * (iOS before the first unlock, an Android Keystore fault), and is `KEY_UNAVAILABLE`.
 *
 * `databaseExists` asks about every network's database, since one key opens them all.
 */
export async function resolveDatabaseKey(databaseExists: () => boolean): Promise<string> {
  let existing: string | null
  try {
    existing = await readDatabaseKey()
  } catch (error) {
    throw keyUnavailable(describe(error))
  }
  if (existing !== null) {
    if (!HEX_KEY.test(existing)) {
      throw keyInvalid(`${String(existing.length)} characters, not 64 hex digits`)
    }
    return existing
  }
  if (databaseExists()) throw keyMissing()

  // A true first launch, so whatever an older build stored has nothing left to open.
  await retireOldKeys()
  return mintDatabaseKey()
}

/**
 * Writes a new key over whatever is stored. Only for the clear past a key failure, once every
 * database the old key opened is gone: see `discardDatabases`.
 */
export async function replaceDatabaseKey(): Promise<void> {
  // Android keeps its Keystore key across a write, so one it can no longer use goes first.
  await clearDatabaseKey()
  await mintDatabaseKey()
}
