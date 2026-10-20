import type { ElementId } from '@session/test-ids'

export type WithTestID = { testID?: ElementId | undefined }

/** Already worded: what a screen reader announces a picture that did not decode as. */
export type WithFailedLabel = { failedLabel: string }

/** Addresses the mark a tile draws when its picture did not decode, whichever form it takes. */
export type WithFailedTestID = { failedTestID?: ElementId | undefined }
