/**
 * The sequence onboarding performs, against real libsession.
 *
 * Every screen in the flow had been driven against the fake, which answers these three calls
 * happily whatever libsession would do. This is the same three calls through the addon: the
 * account has to be absent before the flow starts, present after the last step, and carry the
 * name that was typed. Offline throughout - nothing here attaches a network, so it runs
 * wherever the addon builds.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSessionClient, type SessionClient } from '@session/client'
import { recoveryWords } from '@session/client-contract'
import { describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')

const describeAddon = existsSync(addon) ? describe : describe.skip

/** A client on its own database, with no account: where onboarding starts. */
async function newcomer(
  seed: number,
): Promise<{ client: SessionClient; dir: string; dispose: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'session-onboarding-'))
  await mkdir(join(dir, 'cache'), { recursive: true })
  const client = createSessionClient(
    createNodeBridgeTransport({
      dbPath: join(dir, 'session.db'),
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(seed),
      // What makes onboarding reachable at all: without it libsession mints an account as the
      // database opens and the flow has nothing left to ask.
      deferAccount: true,
    }),
  )
  return {
    client,
    // Handed back so a test can look at what the discard left on disk: the database is the part
    // the bridge reports on, and the attachment cache is the part nothing else would notice.
    dir,
    dispose: async () => {
      client.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/**
 * The same phrase with a real word in the wrong place: every word genuine, the checksum not.
 *
 * The thirteenth word is a repeat of one of the first twelve, at the position a checksum over
 * their three-letter prefixes names. So putting a different one of those twelve last cannot match,
 * whatever the seed: only the word at that position is the one that belongs there.
 *
 * **Exchanging two words instead would be wrong roughly one phrase in twelve.** A swap permutes
 * the prefixes, so the checksum names a different position, and that position can hold a word
 * equal to the thirteenth -- leaving a phrase that restores.
 */
function miscopiedPhrase(words: string[]): string[] {
  const prefix = (word: string) => word.slice(0, 3)
  const tail = words[12]
  if (tail === undefined) throw new Error('a phrase this short has no checksum word')
  const stand = words.slice(0, 12).find((word) => prefix(word) !== prefix(tail))
  if (stand === undefined) throw new Error('a phrase of twelve identical prefixes cannot happen')
  const broken = [...words]
  broken[12] = stand
  return broken
}

describeAddon('onboarding, against libsession', () => {
  it('creates an account and names it, in the order the flow does', async () => {
    const { client, dispose } = await newcomer(11)

    try {
      const before = await client.getAccountInfo()
      expect(before.haveAccount).toBe(false)
      expect(before.sessionId).toBeUndefined()

      await client.createAccount()
      await client.setDisplayName('Weekend Test')

      const after = await client.getAccountInfo()
      expect(after.haveAccount).toBe(true)
      expect(after.sessionId).toMatch(/^05[0-9a-f]{64}$/)
      expect(after.displayName).toBe('Weekend Test')
    } finally {
      await dispose()
    }
  })

  it('brings the same account back from the same seed', async () => {
    // The property the recovery screen rests on. Asserted as agreement between two databases
    // rather than against a written-down ID, so it is libsession's derivation being checked and
    // not a constant somebody pasted.
    const hexSeed = 'a1'.repeat(32)
    const first = await newcomer(12)
    const second = await newcomer(13)

    try {
      await first.client.restoreAccount({ hexSeed })
      await second.client.restoreAccount({ hexSeed })

      const one = await first.client.getAccountInfo()
      const two = await second.client.getAccountInfo()
      expect(one.sessionId).toMatch(/^05[0-9a-f]{64}$/)
      expect(two.sessionId).toBe(one.sessionId)
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })

  it('takes back the words it gave out', async () => {
    // The whole of restore, end to end: the phrase the account screen shows is the phrase the
    // recovery screen has to accept, and it has to bring back the same identity. Read out of
    // libsession rather than written here, because a pasted phrase tests the paste.
    const origin = await newcomer(15)
    const restored = await newcomer(16)

    try {
      await origin.client.createAccount()
      const words = await recoveryWords(origin.client)
      const mine = await origin.client.getAccountInfo()

      await restored.client.restoreAccount({ words })
      const theirs = await restored.client.getAccountInfo()
      expect(theirs.sessionId).toBe(mine.sessionId)
    } finally {
      await origin.dispose()
      await restored.dispose()
    }
  })

  it('tells a misspelt phrase apart from a mistyped one', async () => {
    // Two refusals the recovery screen says different things about. libsession distinguishes
    // them - an unknown word by name, a checksum that does not add up - and the messages have to
    // stay distinguishable for that screen to keep being able to.
    const origin = await newcomer(17)
    const typist = await newcomer(18)
    const client = typist.client

    try {
      await origin.client.createAccount()
      const words = await recoveryWords(origin.client)

      const misspelt = [...words]
      misspelt[0] = 'zzzzz'
      const misspeltError = await client
        .restoreAccount({ words: misspelt })
        .catch((e: unknown) => e)

      const checksumError = await client
        .restoreAccount({ words: miscopiedPhrase(words) })
        .catch((e: unknown) => e)

      expect(String(misspeltError)).toContain('zzzzz')
      expect(String(checksumError)).toMatch(/checksum/i)

      // Two refusals in a row on the same client, and still nothing minted: what lets the screen
      // put somebody back on the field they typed into as many times as they need.
      expect((await client.getAccountInfo()).haveAccount).toBe(false)
    } finally {
      await origin.dispose()
      await typist.dispose()
    }
  })

  it('checks a phrase without making an account out of it', async () => {
    // What lets the recovery screen refuse a phrase and still leave nothing behind to undo, so
    // going back from it needs no warning and no cleanup.
    const origin = await newcomer(19)
    const checker = await newcomer(20)

    try {
      await origin.client.createAccount()
      const words = await recoveryWords(origin.client)

      await checker.client.checkRecoveryPhrase(words)
      expect((await checker.client.getAccountInfo()).haveAccount).toBe(false)

      // And the phrase it accepted is then a phrase that restores. The check is the restore's own
      // decode with the result discarded, so these two answers cannot come apart.
      await checker.client.restoreAccount({ words })
      expect((await checker.client.getAccountInfo()).sessionId).toBe(
        (await origin.client.getAccountInfo()).sessionId,
      )
    } finally {
      await origin.dispose()
      await checker.dispose()
    }
  })

  it('refuses the same phrases the restore would, and by the same names', async () => {
    const origin = await newcomer(21)
    const checker = await newcomer(22)

    try {
      await origin.client.createAccount()
      const words = await recoveryWords(origin.client)

      const misspelt = [...words]
      misspelt[0] = 'zzzzz'
      const unknownWord = await checker.client
        .checkRecoveryPhrase(misspelt)
        .catch((e: unknown) => e)
      expect(String(unknownWord)).toContain('zzzzz')

      const badChecksum = await checker.client
        .checkRecoveryPhrase(miscopiedPhrase(words))
        .catch((e: unknown) => e)
      expect(String(badChecksum)).toMatch(/checksum/i)

      // Half a phrase. libsession takes 12, 13, 24 or 25 words and refuses every other length
      // before it looks a single word up, which is the rule the fake mirrors.
      const halfOfIt = await checker.client
        .checkRecoveryPhrase(words.slice(0, 7))
        .catch((e: unknown) => e)
      expect(halfOfIt).toBeInstanceOf(Error)

      expect((await checker.client.getAccountInfo()).haveAccount).toBe(false)
    } finally {
      await origin.dispose()
      await checker.dispose()
    }
  })

  it('refuses a seed it cannot read, leaving the account unmade', async () => {
    // The restore screen shows the phrase back with an error on it, which is only possible if a
    // refusal leaves the flow where it was rather than half an account behind.
    const { client, dispose } = await newcomer(14)

    try {
      await expect(client.restoreAccount({ hexSeed: 'nonsense' })).rejects.toThrow(/hexSeed/)

      const info = await client.getAccountInfo()
      expect(info.haveAccount).toBe(false)
    } finally {
      await dispose()
    }
  })
})

/**
 * What must be true of a database somebody backed out of.
 *
 * The sharp end of onboarding: somebody who starts restoring one account, changes their mind and
 * restores another must carry nothing of the first into the second. Asserted against real
 * libsession rather than the fake, which would agree whatever libsession did.
 *
 * Written against the guarantee rather than the mechanism, so it survives the coming change from
 * minting late to minting early and discarding on the way back.
 */
describeAddon('backing out of onboarding', () => {
  it('leaves a database nothing can be recovered from', async () => {
    const abandoned = await newcomer(23)

    try {
      const words = await (async () => {
        const origin = await newcomer(24)
        try {
          await origin.client.createAccount()
          return await recoveryWords(origin.client)
        } finally {
          await origin.dispose()
        }
      })()

      // As far into restore as the flow goes before it commits: the phrase is checked, and
      // checking is all it does.
      await abandoned.client.checkRecoveryPhrase(words)

      // Now back out. There is nothing to undo, which is the point.
      const info = await abandoned.client.getAccountInfo()
      expect(info.haveAccount).toBe(false)
      expect(info.sessionId).toBeUndefined()
      expect(info.displayName).toBeUndefined()
      expect(await abandoned.client.getConversations()).toEqual([])
      expect(await abandoned.client.getMessageRequests()).toEqual([])
    } finally {
      await abandoned.dispose()
    }
  })

  it('does not carry one account into the next', async () => {
    // Two phrases, the same database: start restoring the first, change your mind, restore the
    // second. Nothing of the first may survive - which is the case the whole guarantee exists for.
    const first = await newcomer(25)
    const second = await newcomer(26)
    const device = await newcomer(27)

    try {
      await first.client.createAccount()
      await first.client.setDisplayName('First')
      const firstWords = await recoveryWords(first.client)
      const firstId = (await first.client.getAccountInfo()).sessionId

      await second.client.createAccount()
      const secondWords = await recoveryWords(second.client)
      const secondId = (await second.client.getAccountInfo()).sessionId
      expect(secondId).not.toBe(firstId)

      // Started, then abandoned.
      await device.client.checkRecoveryPhrase(firstWords)
      expect((await device.client.getAccountInfo()).haveAccount).toBe(false)

      // And the one actually chosen.
      await device.client.restoreAccount({ words: secondWords })
      const settled = await device.client.getAccountInfo()
      expect(settled.sessionId).toBe(secondId)
      expect(settled.sessionId).not.toBe(firstId)
      // The first account's name was never reachable from here, and still is not.
      expect(settled.displayName).not.toBe('First')
    } finally {
      await first.dispose()
      await second.dispose()
      await device.dispose()
    }
  })
})

/**
 * An onboarding that never touches the disk.
 *
 * libSession opens on `:memory:` as readily as on a file, which is what makes a discardable
 * onboarding possible: the account is real -- it mints, it names itself, it hands back a mnemonic,
 * it attaches a network -- and there is no file behind it to survive a crash or need deleting.
 *
 * These are the assertions that turn "nothing is left behind" from a claim into something CI can
 * check, which was the question asked: not how it is discarded, but how we *know*.
 */
describeAddon('an in-memory onboarding', () => {
  /** A client on a database that exists only in this process. */
  function inMemory(seed: number, dir: string): SessionClient {
    return createSessionClient(
      createNodeBridgeTransport({
        dbPath: ':memory:',
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(seed),
        deferAccount: true,
      }),
    )
  }

  it('does everything onboarding needs, and writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'session-inmemory-'))
    await mkdir(join(dir, 'cache'), { recursive: true })
    // Everything in the directory before, so the comparison is against reality rather than an
    // assumption about which files libSession would have created.
    const before = (await readdir(dir)).sort()
    const client = inMemory(31, dir)

    try {
      await client.createAccount()
      await client.setDisplayName('Provisional')

      const info = await client.getAccountInfo()
      expect(info.haveAccount).toBe(true)
      expect(info.sessionId).toMatch(/^05[0-9a-f]{64}$/)
      expect(info.displayName).toBe('Provisional')
      // The phrase is available too, which is what a restore would need to hand on.
      expect(await client.getSeedMnemonic()).toHaveLength(13)

      expect((await readdir(dir)).sort()).toEqual(before)
    } finally {
      client.close()
      // And still nothing, after it is gone.
      expect((await readdir(dir)).sort()).toEqual(before)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('takes the account with it when it is discarded', async () => {
    // The discard itself: close the client and the database goes, because the database was never
    // anywhere but in it. A second client on the same settings starts from nothing, which is the
    // property that makes going back safe.
    const dir = await mkdtemp(join(tmpdir(), 'session-inmemory-'))
    await mkdir(join(dir, 'cache'), { recursive: true })

    try {
      const abandoned = inMemory(32, dir)
      await abandoned.createAccount()
      const gone = (await abandoned.getAccountInfo()).sessionId
      expect(gone).toBeDefined()
      abandoned.close()

      const next = inMemory(32, dir)
      try {
        const fresh = await next.getAccountInfo()
        expect(fresh.haveAccount).toBe(false)
        expect(fresh.sessionId).toBeUndefined()
      } finally {
        next.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/**
 * Discarding an account, against real libsession.
 *
 * The contract suite asserts what both implementations can promise — that what the old account
 * stored is gone. These are the parts only the real bridge can be held to: that the identity is
 * genuinely new, and that whether there is an account afterwards follows how the client was
 * opened rather than the discard itself.
 */
describeAddon('discarding an account', () => {
  it('leaves a deferred client with no account at all', async () => {
    const { client, dispose } = await newcomer(41)

    try {
      await client.createAccount()
      await client.setDisplayName('Abandoned')
      const before = await client.getAccountInfo()
      expect(before.haveAccount).toBe(true)

      await client.discardAccount()

      // Deferred, so reopening mints nothing: this is the first screen again.
      const after = await client.getAccountInfo()
      expect(after.haveAccount).toBe(false)
      expect(after.sessionId).toBeUndefined()
      expect(after.displayName).toBeUndefined()
    } finally {
      await dispose()
    }
  })

  it('leaves the network cache where it is', async () => {
    // **The other half of the same decision, and the one nothing was holding.** Every artefact
    // beside the database is either taken or kept on purpose; taking this one is not a leak but
    // it throws away the public service-node list, so the next attempt pays for discovery again
    // on a connection somebody has already decided is slow enough to back out of.
    //
    // Written by hand rather than waited for: populating it needs a network, and what is being
    // pinned is which paths a discard reaches.
    const { client, dir, dispose } = await newcomer(46)

    try {
      await client.createAccount()
      const netcache = join(dir, 'netcache')
      await mkdir(netcache, { recursive: true })
      await writeFile(join(netcache, 'snode_pool'), 'pretend this is the node list')

      await client.discardAccount()

      expect(existsSync(join(netcache, 'snode_pool'))).toBe(true)
    } finally {
      await dispose()
    }
  })

  it('takes the attachment cache with it', async () => {
    // **The part the bridge cannot report on.** Everything else here is asked of the client, and
    // the client would answer exactly the same way with somebody's downloaded profile pictures
    // still sitting beside the database -- unreadable, since their key went with it, but present.
    // Backing out of onboarding is supposed to leave nothing.
    const { client, dir, dispose } = await newcomer(45)

    try {
      await client.createAccount()
      const downloaded = join(dir, 'cache', 'profile-picture')
      await writeFile(downloaded, 'pretend this is an avatar')

      await client.discardAccount()

      expect(existsSync(downloaded)).toBe(false)
      // Not asserted here: that the old database's journals are gone. The discard opens a fresh
      // database immediately, which writes journals of its own, so their presence afterwards says
      // nothing about whether the previous ones were removed. That the account is genuinely new is
      // the test below.
    } finally {
      await dispose()
    }
  })

  it('gives a genuinely different identity to the next account', async () => {
    // The property the isolation rests on. A name-derived or reused ID would satisfy every other
    // assertion here and still be the leak.
    const { client, dispose } = await newcomer(42)

    try {
      await client.createAccount()
      const first = (await client.getAccountInfo()).sessionId

      await client.discardAccount()
      await client.createAccount()
      const second = (await client.getAccountInfo()).sessionId

      expect(first).toMatch(/^05[0-9a-f]{64}$/)
      expect(second).toMatch(/^05[0-9a-f]{64}$/)
      expect(second).not.toBe(first)
    } finally {
      await dispose()
    }
  })

  it('does not take the recovery phrase of the discarded account with it', async () => {
    // Restoring one account, changing your mind, and restoring another: the exact case.
    const origin = await newcomer(43)
    const device = await newcomer(44)

    try {
      await origin.client.createAccount()
      const words = await recoveryWords(origin.client)
      const theirs = (await origin.client.getAccountInfo()).sessionId

      await device.client.restoreAccount({ words })
      expect((await device.client.getAccountInfo()).sessionId).toBe(theirs)

      await device.client.discardAccount()
      await device.client.createAccount()

      // A fresh identity, not the restored one coming back.
      expect((await device.client.getAccountInfo()).sessionId).not.toBe(theirs)
    } finally {
      await origin.dispose()
      await device.dispose()
    }
  })
})

describeAddon('the conversation list a new account starts with', () => {
  it('can be read back', async () => {
    // The flow re-hydrates the moment an account exists, and re-hydrating lists conversations.
    // libsession refused that list on a freshly created account -- "Invalid conversation id: not
    // a hex session or group ID" -- which surfaced as an unexplained "something went wrong" at the
    // end of onboarding on every platform, and on a relaunch as a launch screen that never left.
    const { client, dispose } = await newcomer(23)

    try {
      await client.createAccount()
      await expect(client.getConversations()).resolves.toBeInstanceOf(Array)
      await expect(client.getMessageRequests()).resolves.toBeInstanceOf(Array)
    } finally {
      await dispose()
    }
  })
})

describeAddon('the conversation list a new account starts with, on a real device type', () => {
  it('can be read back', async () => {
    // The apps declare what they are, which makes `createAccount` publish a device record before
    // it answers. The harness above declares nothing, so it never took that path -- and that path
    // is the difference between a list that reads back and one libsession refuses.
    const dir = await mkdtemp(join(tmpdir(), 'session-device-type-'))
    await mkdir(join(dir, 'cache'), { recursive: true })
    const client = createSessionClient(
      createNodeBridgeTransport({
        dbPath: join(dir, 'session.db'),
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(31),
        deferAccount: true,
        deviceType: 'desktop',
      }),
    )

    try {
      await client.createAccount()
      await expect(client.getConversations()).resolves.toBeInstanceOf(Array)
    } finally {
      client.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
