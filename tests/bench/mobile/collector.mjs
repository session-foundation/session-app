#!/usr/bin/env node
import { createServer } from 'node:http'

/**
 * Catches the results the phone posts back, prints them, and exits.
 *
 * Run it beside `expo start`. It keeps listening: a benchmark is normally run more than once -
 * to see whether the numbers are stable, or after a change - and a collector that exits on the
 * first report means noticing that only when the second run appears to have vanished.
 */
const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    try {
      const { platform, version, engine, rows, kind } = JSON.parse(body)
      const pad = (v, w, left) => (left ? String(v).padEnd(w) : String(v).padStart(w))
      console.log(`\n== ${platform} ${version} · ${engine}${kind === 'render' ? ' · RENDER (mount ms)' : ''} ==\n`)
      console.log(
        `${pad('rows', 6, true)}${pad('KB', 8)}${pad('decode', 9)}${pad('project', 9)}${pad('TOTAL', 8)}`,
      )
      console.log('-'.repeat(40))
      for (const r of rows) {
        console.log(
          `${pad(r.label, 6, true)}${pad(r.kb.toFixed(1), 8)}${pad(r.decode.toFixed(3), 9)}${pad(r.project.toFixed(3), 9)}${pad(r.total.toFixed(3), 8)}`,
        )
      }
      console.log('')
    } catch (e) {
      console.error('could not read the report:', e.message, body.slice(0, 200))
    }
  })
})

server.listen(19999, '0.0.0.0', () => console.log('collector listening on :19999'))
