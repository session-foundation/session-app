/** The access an export destination can need: storage on Android 8 and 9, photos on iOS. */
export type ExportAccess = 'storage' | 'photoLibrary'

/**
 * Rejected by `chooseExportLocation` when the destination needs access that was refused: on
 * Android any refusal of storage, on iOS one the OS will not ask about again.
 */
export class ExportAccessRefused extends Error {
  override readonly name = 'ExportAccessRefused'
  readonly access: ExportAccess

  constructor(access: ExportAccess) {
    super(`${access} access is refused`)
    this.access = access
  }
}
