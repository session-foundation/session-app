import type { SessionClient } from '@session/client'

/**
 * The words of an account whose recovery password nothing has hidden, which is every account a
 * test makes unless it hides it on purpose.
 */
export async function recoveryWords(client: SessionClient): Promise<string[]> {
  const words = await client.getSeedMnemonic()
  if (words === null) throw new Error('the recovery password is hidden')
  return words
}

/** The seed in hex, as `recoveryWords` gives the words. */
export async function recoveryHex(client: SessionClient): Promise<string> {
  const hex = await client.getSeedHex()
  if (hex === null) throw new Error('the recovery password is hidden')
  return hex
}
