import { KEY_INVALID, KEY_MISSING, KEY_UNAVAILABLE } from '@session/client'
import * as SecureStore from 'expo-secure-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { replaceDatabaseKey, resolveDatabaseKey } from '#src/storage/databaseKey'

/** The keychain, as expo-secure-store presents it: a map, and a read that can be made to throw. */
const keychain = vi.hoisted(() => ({
  items: new Map<string, string>(),
  readFails: null as Error | null,
}))

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  getItemAsync: (key: string) =>
    keychain.readFails === null
      ? Promise.resolve(keychain.items.get(key) ?? null)
      : Promise.reject(keychain.readFails),
  setItemAsync: (key: string, value: string) => {
    keychain.items.set(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string) => {
    keychain.items.delete(key)
    return Promise.resolve()
  },
}))

vi.mock('expo-crypto', () => ({
  getRandomBytes: (count: number) => Uint8Array.from({ length: count }, (_, i) => i),
}))

const KEY = 'session.db.key.this-device'
const STORED = 'ab'.repeat(32)
const noDatabase = () => false
const aDatabase = () => true

beforeEach(() => {
  keychain.items.clear()
  keychain.readFails = null
})

describe('the mobile database key', () => {
  it('is made on a true first launch, and the retired items go', async () => {
    keychain.items.set('session.db.key', 'old')
    const key = await resolveDatabaseKey(noDatabase)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(keychain.items.get(KEY)).toBe(key)
    expect(keychain.items.has('session.db.key')).toBe(false)
  })

  it('is the stored one when there is one', async () => {
    keychain.items.set(KEY, STORED)
    await expect(resolveDatabaseKey(aDatabase)).resolves.toBe(STORED)
  })

  it('is never made while a database exists without one, and nothing is deleted', async () => {
    keychain.items.set('session.db.key', 'old')
    await expect(resolveDatabaseKey(aDatabase)).rejects.toMatchObject({ code: KEY_MISSING })
    expect(keychain.items.has(KEY)).toBe(false)
    expect(keychain.items.get('session.db.key')).toBe('old')
  })

  it('is unavailable, not made, when the keychain will not answer', async () => {
    keychain.readFails = new Error('User interaction is not allowed.')
    await expect(resolveDatabaseKey(noDatabase)).rejects.toMatchObject({
      code: KEY_UNAVAILABLE,
      message: 'the database key could not be read: User interaction is not allowed.',
    })
    expect(keychain.items.size).toBe(0)
  })

  it('is refused, not replaced, when what is stored is not a key', async () => {
    keychain.items.set(KEY, 'abc')
    await expect(resolveDatabaseKey(aDatabase)).rejects.toMatchObject({ code: KEY_INVALID })
    expect(keychain.items.get(KEY)).toBe('abc')
  })

  it('is replaced only by the clear, which removes whatever is stored first', async () => {
    keychain.items.set(KEY, 'abc')
    const deleted = vi.spyOn(SecureStore, 'deleteItemAsync')
    await replaceDatabaseKey()
    expect(deleted).toHaveBeenCalledWith(KEY, expect.anything())
    expect(keychain.items.get(KEY)).toMatch(/^[0-9a-f]{64}$/)
  })
})
