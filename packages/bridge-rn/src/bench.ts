/**
 * The benchmark HybridObject's types.
 *
 * A separate entry point from `index.ts` so that nothing which imports the bridge picks these up:
 * they exist to price a JSI property access and have no business in an app bundle. The boundary
 * rules put the dev-only import path behind the same check as the rest of `apps/mobile/src/dev`.
 */

export type {
  BenchAutoDownload,
  BenchConversation,
  BenchConversationHandle,
  BenchConversationKind,
  BenchMessage,
  BenchMessageHandle,
  BenchSendState,
  BenchStructs,
} from './BenchStructs.nitro'
