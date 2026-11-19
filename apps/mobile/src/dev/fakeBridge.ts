import { serveNativeMediaFrom, type BridgeTransport } from '@session/client'
import { Platform } from 'react-native'
import {
  createFakeMediaSource,
  createFakeTransport,
  startDevFake,
  type FakeDevEnv,
  type FakeSessionClient,
} from '@session/client/fake'

import { pushedPhotos, readPushedPhoto, readStagedHead, writeFakeExport } from '../storage/devMedia'
import { fakeExportSource } from './fakeMedia'

/**
 * The fake's export, plus the file it stands for.
 *
 * The fake has no disk, and on mobile the export is not finished when libsession answers: the
 * files port still has to hand the file to the photo library or a folder, which needs one there.
 */
function writingExports(client: FakeSessionClient, photos: ReadonlyMap<string, string>): void {
  const exportAttachment = client.exportAttachment.bind(client)
  client.exportAttachment = async (messageId, index, destination, options) => {
    const landed = await exportAttachment(messageId, index, destination, options)
    writeFakeExport(landed, fakeExportSource(client, { messageId, index }, photos))
    return landed
  }
}

/**
 * The bridge, backed by the fake - the same arrangement the desktop app uses, so both
 * platforms show the same seeded conversations while the real bridge is being built.
 *
 * Every variable is spelled out: Expo inlines `process.env.EXPO_PUBLIC_*` only where the name is
 * written literally. They are the same names desktop reads.
 */
export function createFakeBridge(): BridgeTransport {
  const photos = pushedPhotos()
  const env: Required<FakeDevEnv> = {
    EXPO_PUBLIC_SESSION_FAKE_FIXTURE: process.env['EXPO_PUBLIC_SESSION_FAKE_FIXTURE'],
    EXPO_PUBLIC_SESSION_NO_ACCOUNT: process.env['EXPO_PUBLIC_SESSION_NO_ACCOUNT'],
    EXPO_PUBLIC_SESSION_FAKE_ROWS: process.env['EXPO_PUBLIC_SESSION_FAKE_ROWS'],
    EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS: process.env['EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS'],
    EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY: process.env['EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY'],
    EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN: process.env['EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN'],
    EXPO_PUBLIC_SESSION_FAKE_PATHS: process.env['EXPO_PUBLIC_SESSION_FAKE_PATHS'],
    EXPO_PUBLIC_SESSION_ROUTER: process.env['EXPO_PUBLIC_SESSION_ROUTER'],
    // TODO: a Developer Settings switch that fails the next launch, once that screen exists, so a
    // build without this variable can reach the failure screen too.
    EXPO_PUBLIC_SESSION_FAKE_FAILED_START: process.env['EXPO_PUBLIC_SESSION_FAKE_FAILED_START'],
  }
  const { alice, served } = startDevFake(env, {
    has: (fileName) => photos.has(fileName),
    where: 'on the device',
    fix: 'pnpm fake-media:fetch && pnpm --filter @session/mobile fake-media:push',
  })

  writingExports(alice, photos)
  alice.readStagedFilesWith({
    decodesHeic: Platform.OS === 'ios',
    sizeOf: async (path) => (await readStagedHead(path, 0)).size,
  })
  // Through the real loaders: the port is platform.ts's, and only the bytes are the fake's.
  serveNativeMediaFrom(
    createFakeMediaSource(
      alice,
      async (photo) => {
        const uri = photos.get(photo)
        if (uri === undefined) throw new Error(`no dev photograph ${photo}`)
        return readPushedPhoto(uri)
      },
      readStagedHead,
    ),
  )

  return createFakeTransport(served)
}
