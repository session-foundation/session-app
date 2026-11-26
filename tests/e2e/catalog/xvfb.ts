import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'

import type { WindowSize } from '#catalog/captureWindow'

/** An X server of its own, as `DISPLAY` names it. */
export interface Screen {
  display: string
  stop(): Promise<void>
}

const READY_MS = 15_000

/** Starts Xvfb on the first free display and resolves once it accepts connections. */
export function startXvfb(size: WindowSize): Promise<Screen> {
  // -displayfd: Xvfb picks a free display and writes its number there once it is listening.
  const server = spawn(
    'Xvfb',
    [
      '-displayfd',
      '3',
      '-nolisten',
      'tcp',
      '-screen',
      '0',
      `${String(size.width)}x${String(size.height)}x24`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] },
  )
  const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))
  const stop = async () => {
    if (server.exitCode === null && server.signalCode === null) server.kill()
    await exited
  }
  let said = ''
  server.stderr?.on('data', (chunk: Buffer) => (said += chunk.toString()))
  return new Promise<Screen>((resolve, reject) => {
    let settled = false
    const fail = (why: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void stop().then(() => reject(new Error(`Xvfb ${why}: ${said.trim()}`)))
    }
    const timer = setTimeout(() => fail(`was not ready in ${String(READY_MS)} ms`), READY_MS)
    server.once('error', (error) => fail(`could not start (${error.message})`))
    server.once('exit', (code) => fail(`exited with ${String(code)}`))
    let number = ''
    ;(server.stdio[3] as Readable).on('data', (chunk: Buffer) => {
      number += chunk.toString()
      if (settled || !number.includes('\n')) return
      settled = true
      clearTimeout(timer)
      resolve({ display: `:${number.trim()}`, stop })
    })
  })
}
