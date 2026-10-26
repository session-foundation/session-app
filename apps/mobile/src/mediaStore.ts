import { requireNativeModule } from 'expo'
import { Platform } from 'react-native'

interface MediaStoreModule {
  save(sourcePath: string, name: string, media: boolean): Promise<string>
}

/**
 * Saves a file where legacy Android does: a picture, a video or a sound into its own collection
 * when `media`, anything else into Downloads. Resolves to the saved file's URI. See
 * `modules/media-store`.
 *
 * Null on iOS.
 */
export const saveToMediaStore:
  ((sourcePath: string, name: string, media: boolean) => Promise<string>) | null =
  Platform.OS === 'android'
    ? (sourcePath, name, media) =>
        requireNativeModule<MediaStoreModule>('MediaStore').save(sourcePath, name, media)
    : null
