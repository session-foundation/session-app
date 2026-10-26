import { ExportAccessRefused, type FilesPort } from '@session/app'
import * as Crypto from 'expo-crypto'
import { Asset, requestPermissionsAsync } from 'expo-media-library'
import { Linking, PermissionsAndroid, Platform } from 'react-native'

import {
  exportFileName,
  isMediaStoreMedia,
  numberedName,
  partName,
  photoLibraryTakes,
  placeUnderFreeName,
  stagedPath,
  StagedExports,
} from './exportPaths'
import { saveToMediaStore } from './mediaStore'
import { fileUri, plainPath } from './storage/layout'
import {
  copyOut,
  exportsSubdirectory,
  File,
  pickDirectory,
  removeIfPresent,
  type Directory,
} from './storage/roots'

/**
 * Where an export goes once libsession has written it, which is where the legacy clients put it:
 * on Android, MediaStore, filed by type; on iOS, Photos or a folder somebody picks. None is a path
 * libsession could write to, so the file is staged first.
 */
type Delivery =
  { to: 'mediaStore'; media: boolean } | { to: 'photos' } | { to: 'folder'; folder: Directory }

// A directory of its own, so that the log export's clean-up of the root never reaches one.
const EXPORT_ROOT = plainPath(exportsSubdirectory('attachments').uri).replace(/\/+$/, '')

const staged = new StagedExports<Delivery>(EXPORT_ROOT)

function removeStaging(token: string): void {
  try {
    removeIfPresent(`${EXPORT_ROOT}/${token}`)
  } catch {
    // Already gone, or never made; the sweep at the next launch has the same job.
  }
}

/**
 * Deletes every staged export a previous run left behind.
 *
 * A staged file is the attachment decrypted, outside libsession's encrypted cache, so none may
 * outlive the export it was made for.
 */
export function sweepStagedExports(): void {
  try {
    removeIfPresent(EXPORT_ROOT)
  } catch {
    // Nothing to sweep is the common case.
  }
}

/**
 * Whether an `exportAttachment` destination is one this port handed out and nothing has written
 * to, spending it.
 *
 * The check desktop's main process makes before a request reaches the native write: that
 * command writes anywhere, and the name in the path came from the sender.
 */
export function mayExportTo(destination: unknown): boolean {
  return staged.admit(destination)
}

/**
 * Android 9 and below save through the filesystem, which takes the storage grant. Any refusal
 * stops the export with the dialog that leads to the settings: there is nowhere else to put the
 * file without the grant.
 */
async function requireStorageGrant(): Promise<void> {
  const answer = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
  )
  if (answer !== PermissionsAndroid.RESULTS.GRANTED) throw new ExportAccessRefused('storage')
}

/**
 * Whether iOS Photos will take a save, asking for add-only access. A refusal the OS will ask
 * about again is false; one it will not is thrown, since only the system settings can undo it.
 */
async function photosWritable(): Promise<boolean> {
  const permission = await requestPermissionsAsync(true, ['photo', 'video'])
  if (permission.granted) return true
  if (!permission.canAskAgain) throw new ExportAccessRefused('photoLibrary')
  return false
}

async function chooseDelivery(contentType: string | undefined): Promise<Delivery | null> {
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) < 29) await requireStorageGrant()
    return { to: 'mediaStore', media: isMediaStoreMedia(contentType) }
  }
  // A refusal the OS will ask about again sends the picture to a folder, as any other file.
  if (photoLibraryTakes(contentType, 'ios') && (await photosWritable())) return { to: 'photos' }
  const folder = await pickDirectory()
  return folder === null ? null : { to: 'folder', folder }
}

/**
 * Opens where an export went, as desktop opens its file manager on the file: the picture or video
 * in the gallery, anything else in Downloads.
 *
 * Best effort. The file has landed by now, so a device with nothing to open it in has lost
 * nothing, and the export is not reported as failed for it.
 */
async function revealDelivered(delivery: Delivery, landed: string | null): Promise<void> {
  try {
    if (delivery.to === 'mediaStore' && !delivery.media) {
      await Linking.sendIntent('android.intent.action.VIEW_DOWNLOADS')
    } else if (Platform.OS === 'ios') {
      // iOS has no view of one photo or one folder another app can be pointed at from here, so
      // it opens the app that holds it.
      await Linking.openURL(delivery.to === 'photos' ? 'photos-redirect://' : 'shareddocuments://')
    } else if (landed?.startsWith('content://') === true) {
      // A file:// URL is refused to other apps on Android 7 and up; a save on 9 and below lands
      // as one only when the scanner did not answer.
      await Linking.openURL(landed)
    }
  } catch {
    // Nothing on the device opens it; the file is where it was put either way.
  }
}

const NAME_IN_USE = new Error('name in use')

/** Runs `place` under the first name `nameFor` gives that `folder` does not hold yet. */
function inFolderUnderFreeName(
  folder: Directory,
  name: string,
  nameFor: (name: string, n: number) => string,
  place: (candidate: string) => void | Promise<void>,
): Promise<void> {
  return placeUnderFreeName(
    name,
    async (candidate) => {
      if (new File(folder, candidate).exists) throw NAME_IN_USE
      await place(candidate)
    },
    (error) => error === NAME_IN_USE,
    nameFor,
  )
}

/**
 * Copies into a picked iOS folder under a temporary name and renames it into place, so a copy
 * that dies leaves a file that looks unfinished rather than one that looks whole. Neither step
 * replaces a file already there; the file manager also refuses both onto a name in use.
 */
async function copyThenRename(staged: File, folder: Directory): Promise<void> {
  const name = staged.name
  await inFolderUnderFreeName(folder, name, partName, async (candidate) => {
    staged.rename(candidate)
    await copyOut(staged, folder)
  })
  const part = new File(folder, staged.name)
  try {
    await inFolderUnderFreeName(folder, name, numberedName, (candidate) => {
      part.rename(candidate)
    })
  } catch (error) {
    try {
      part.delete()
    } catch {
      // Gone already; the failure being reported is the rename's.
    }
    throw error
  }
}

/** Puts a staged file where `delivery` says; resolves to what to open afterwards, if anything. */
async function deliver(file: File, delivery: Delivery): Promise<string | null> {
  if (delivery.to === 'mediaStore') {
    if (saveToMediaStore === null) throw new Error('MediaStore is Android only')
    return saveToMediaStore(plainPath(file.uri), file.name, delivery.media)
  }
  if (delivery.to === 'photos') return (await Asset.create(file.uri)).id
  await copyThenRename(file, delivery.folder)
  return null
}

/**
 * Exporting, on mobile, to where the legacy clients put the file. Android saves everything
 * through MediaStore and asks for nothing from Android 10; iOS sends a picture or a video to
 * Photos and anything else to a folder somebody picks. Once it has landed, where it went is
 * opened, as desktop opens its file manager.
 */
export const exportFiles: Pick<FilesPort, 'chooseExportLocation' | 'revealInFolder'> = {
  async chooseExportLocation(suggestedName, contentType) {
    const delivery = await chooseDelivery(contentType)
    if (delivery === null) return null
    const token = Crypto.randomUUID()
    exportsSubdirectory(`attachments/${token}`)
    staged.stage(token, delivery)
    return stagedPath(EXPORT_ROOT, token, exportFileName(suggestedName, contentType))
  },

  async revealInFolder(path) {
    const written = staged.deliver(path)
    if (written === null) throw new Error('not a staged export')
    const { token, delivery } = written
    let landed: string | null
    try {
      landed = await deliver(new File(fileUri(path)), delivery)
    } finally {
      removeStaging(token)
    }
    await revealDelivered(delivery, landed)
  },
}
