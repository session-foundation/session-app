import { describe, expect, it } from 'vitest'

import { absentSubmodules, pnpmSteps, turboTasksIn } from '#src/ci'

const WORKFLOW = `
      - run: git submodule update --init --recursive packages/localization/src/localization-src
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm boundaries
      - run: pnpm typecheck
      - run: pnpm codegen:check
`

describe('pnpmSteps', () => {
  it('reads every one-line pnpm step, arguments included, with or without a name', () => {
    const workflow = `${WORKFLOW}      - name: Dedupe\n        run: pnpm dedupe --check\n`
    expect(pnpmSteps(workflow)).toEqual({
      steps: [
        'install --frozen-lockfile',
        'lint',
        'boundaries',
        'typecheck',
        'codegen:check',
        'dedupe --check',
      ],
      unreadable: [],
    })
  })

  it('reports a block or chained run that calls pnpm, and ignores a block of git, echo and shell', () => {
    const workflow = `
      - run: |
          if ! git diff --exit-code --stat; then
            git diff
            echo "::error::changed"
            exit 1
          fi
      - name: Knip
        run: |
          echo checking
          pnpm knip
      - run: "pnpm test"
`
    expect(pnpmSteps(workflow)).toEqual({
      steps: [],
      unreadable: ['line 9: run: |', 'line 12: - run: "pnpm test"'],
    })
  })

  it('reports a run that reaches a tool without pnpm, since it may be a check too', () => {
    const workflow = `
      - run: echo done
      - run: npx knip
      - run: node tooling/x.ts
      - run: xvfb-run -a pnpm test:e2e:fast
`
    expect(pnpmSteps(workflow).unreadable).toEqual([
      'line 3: - run: npx knip',
      'line 4: - run: node tooling/x.ts',
      'line 5: - run: xvfb-run -a pnpm test:e2e:fast',
    ])
  })
})

describe('turboTasksIn', () => {
  it('follows each pnpm step to the turbo tasks it starts, and skips the ones that are not turbo', () => {
    const scripts = {
      lint: 'turbo lint',
      boundaries: 'depcruise --config x',
      typecheck: 'turbo run typecheck',
      'codegen:check': 'turbo codegen:check',
    }
    expect(turboTasksIn(WORKFLOW, scripts)).toEqual(['lint', 'typecheck', 'codegen:check'])
  })
})

describe('absentSubmodules', () => {
  it('is every submodule the workflow does not initialise', () => {
    const gitmodules = `
[submodule "libsession-util"]
	path = libsession-util
[submodule "localization"]
	path = packages/localization/src/localization-src
`
    expect(absentSubmodules(gitmodules, WORKFLOW)).toEqual(['libsession-util'])
  })
})
