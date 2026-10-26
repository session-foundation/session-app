// eslint-disable-next-line no-restricted-imports -- the one place the export gate is applied
import { createSessionClient, type BridgeTransport, type SessionClient } from '@session/client'

import { refuseUnstagedExports } from './exportGate'
import { mayExportTo } from './files'

/**
 * The client on top of a bridge transport, with every `exportAttachment` held to a destination
 * the files port staged. The only way the mobile app should make one.
 */
export function mobileClient(transport: BridgeTransport): SessionClient {
  return createSessionClient(refuseUnstagedExports(transport, mayExportTo))
}
