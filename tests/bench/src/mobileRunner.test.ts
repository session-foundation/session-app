import { it } from 'vitest'

import { runJsThreadBench } from '../mobile/src/run'
import { ms, report, table } from './measure'

/**
 * The on-device benchmark, run here.
 *
 * Two jobs. It proves the code the phone will run actually works, without a phone - a bundling or
 * arithmetic mistake found on a device is found slowly. And it produces the desktop baseline in
 * exactly the units the phone reports, so the two can be divided: that ratio is the Hermes-and-
 * phone multiplier, and it is the only thing that can overturn the conclusion that removing the
 * serialisation is not worth it.
 */
it('the mobile runner, on this machine', () => {
  const rows = runJsThreadBench()

  report(
    '\n\n== THE ON-DEVICE BENCHMARK, RUN ON THIS MACHINE ==  milliseconds per call\n\n' +
      table(
        rows.map((r) => [r.label, r.kb.toFixed(1), ms(r.decode), ms(r.project), ms(r.total)]),
        ['rows', 'KB', 'decode', 'project', 'TOTAL'],
      ) +
      '\n' +
      '  This is the baseline. Run the same thing on the phone and divide.\n',
  )
})
