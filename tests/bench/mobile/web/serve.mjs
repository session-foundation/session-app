#!/usr/bin/env node
/**
 * The benchmark in a browser, for a phone that cannot run the app.
 *
 * Expo Go requires an account to open a development server, and a dev client requires signing.
 * Neither is needed to answer half the question: Safari on the device runs the same JavaScript on
 * the same silicon, so this isolates the *hardware* factor cleanly. What it cannot see is the
 * engine factor - JavaScriptCore has a JIT and Hermes does not - so these numbers are optimistic
 * against what the app will actually do, and are a floor rather than an answer.
 *
 * Build the bundle first:
 *   node_modules/.bin/esbuild tests/bench/mobile/src/web-entry.ts --bundle --format=iife \
 *     --outfile=tests/bench/mobile/web/bench.js
 *
 * Then run this and open http://<this machine>:8090 on the phone.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))

const files = {
  '/': ['text/html', () => readFileSync(join(here, 'index.html'))],
  '/bench.js': ['application/javascript', () => readFileSync(join(here, 'bench.js'))],
  '/render': ['text/html', () => readFileSync(join(here, 'render.html'))],
  '/render.js': ['application/javascript', () => readFileSync(join(here, 'render.js'))],
}

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/results') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      try {
        const { platform, version, engine, rows } = JSON.parse(body)
        const pad = (v, w, left) => (left ? String(v).padEnd(w) : String(v).padStart(w))
        console.log(`\n== ${platform} · ${engine} ==\n${version}\n`)
        console.log(`${pad('rows', 6, true)}${pad('KB', 9)}${pad('decode', 10)}${pad('project', 10)}${pad('TOTAL', 9)}`)
        console.log('-'.repeat(44))
        for (const r of rows) {
          console.log(`${pad(r.label, 6, true)}${pad(r.kb.toFixed(1), 9)}${pad(r.decode.toFixed(3), 10)}${pad(r.project.toFixed(3), 10)}${pad(r.total.toFixed(3), 9)}`)
        }
        console.log('')
      } catch (e) {
        console.error('bad report:', e.message)
      }
    })
    return
  }
  const entry = files[req.url ?? '/']
  if (!entry) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': entry[0] }).end(entry[1]())
}).listen(8090, '0.0.0.0', () => console.log('web bench on http://0.0.0.0:8090'))
