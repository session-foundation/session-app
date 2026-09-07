import { runJsThreadBench } from './run'

declare global {
  interface Window {
    runBench: () => void
  }
}

window.runBench = () => {
  const out = document.getElementById('out')
  if (!out) return
  out.textContent = 'Running... the page will freeze, which is the point.'
  setTimeout(() => {
    const rows = runJsThreadBench()
    const pad = (v: string, w: number, left = false) => (left ? v.padEnd(w) : v.padStart(w))
    const lines = [
      `${navigator.userAgent}`,
      '',
      `${pad('rows', 6, true)}${pad('KB', 9)}${pad('decode', 10)}${pad('project', 10)}${pad('TOTAL', 9)}`,
      '-'.repeat(44),
      ...rows.map(
        (r) =>
          `${pad(r.label, 6, true)}${pad(r.kb.toFixed(1), 9)}${pad(r.decode.toFixed(3), 10)}${pad(r.project.toFixed(3), 10)}${pad(r.total.toFixed(3), 9)}`,
      ),
    ]
    out.textContent = lines.join('\n')
    void fetch('/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'web', version: navigator.userAgent, engine: 'JavaScriptCore', rows }),
    }).then(
      () => { out.textContent += '\n\nSent to the dev machine.' },
      () => { out.textContent += '\n\n(could not send; read the numbers above)' },
    )
  }, 60)
}
