import type { BridgeTransport, Frame, Request } from '@session/client'
import { describe, expect, it } from 'vitest'

import { refuseUnstagedExports } from '#src/exportGate'
import { StagedExports, stagedPath } from '#src/exportPaths'

function recording(): BridgeTransport & { sent: Request[] } {
  const sent: Request[] = []
  return {
    sent,
    send: (request) => {
      sent.push(request)
    },
    setSink: () => undefined,
    close: () => undefined,
  }
}

function exportTo(destination: string): Request {
  return {
    id: 3,
    command: {
      type: 'exportAttachment',
      messageId: 7,
      index: 0,
      destination,
      notifySender: true,
      replace: false,
    },
  }
}

describe('the transport in front of the bridge', () => {
  it('passes an export to a staged path through', () => {
    const inner = recording()
    const gated = refuseUnstagedExports(inner, (d) => d === '/staged/x.pdf')

    gated.send(exportTo('/staged/x.pdf'))

    expect(inner.sent).toHaveLength(1)
  })

  it('answers an export anywhere else with an error and never forwards it', () => {
    const inner = recording()
    const frames: Frame[] = []
    const gated = refuseUnstagedExports(inner, () => false)
    gated.setSink((frame) => frames.push(frame))

    gated.send(exportTo('/data/user/0/org.getsession.session2/files/session/mainnet/session.db'))

    expect(inner.sent).toHaveLength(0)
    expect(frames).toEqual([
      {
        type: 'response',
        response: { id: 3, error: 'exportAttachment.destination was not staged' },
      },
    ])
  })

  it('passes one export per staging token and refuses the next, as desktop spends a grant', () => {
    const root = '/data/user/0/org.getsession.session2/cache/session-exports'
    const token = '3f2c1b9a-7d4e-4c55-9f10-2a6b8e0d4c11'
    const staged = new StagedExports<string>(root)
    staged.stage(token, 'photos')
    const inner = recording()
    const frames: Frame[] = []
    const gated = refuseUnstagedExports(inner, (d) => staged.admit(d))
    gated.setSink((frame) => frames.push(frame))

    gated.send(exportTo(stagedPath(root, token, 'x.pdf')))
    gated.send(exportTo(stagedPath(root, token, 'x.pdf')))

    expect(inner.sent).toHaveLength(1)
    expect(frames).toHaveLength(1)
  })

  it('leaves every other command alone', () => {
    const inner = recording()
    const gated = refuseUnstagedExports(inner, () => false)

    gated.send({ id: 1, command: { type: 'getAccountInfo' } })

    expect(inner.sent).toHaveLength(1)
  })
})
