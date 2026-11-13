import { requireOptionalNativeModule } from 'expo'

interface SecureScreenModule {
  setSecure(secure: boolean): Promise<void>
  copySensitive(text: string): Promise<void>
}

/**
 * Android's secure window flag and sensitive clipboard. See `modules/secure-screen`.
 *
 * Null on iOS, which has no such module, and in an Android build made before it existed: the
 * window port then reports that it cannot block capture, and a secret is copied plainly.
 */
export const SecureScreen = requireOptionalNativeModule<SecureScreenModule>('SecureScreen')
