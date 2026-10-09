import type { Check } from '@session/checks'
import { describe, expect, it } from 'vitest'

import { hookDrift } from '#src/hooks'

const WORKFLOW = `
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm dedupe --check
      - name: Something else
        run: |
          git diff --exit-code
`

const CHECKS: Check[] = [
  { run: 'install --frozen-lockfile', stage: 'ci-only', because: 'setup' },
  { run: 'lint', stage: 'pre-push', perPackage: true },
  { run: 'dedupe --check', stage: 'pre-commit' },
]

const COMMIT = {
  path: '.githooks/pre-commit',
  text: '#!/bin/sh\n# pnpm is fine in a comment\nexec pnpm -s checks pre-commit\n',
}
const PUSH = { path: '.githooks/pre-push', text: '#!/bin/sh\nexec pnpm -s checks pre-push\n' }
const HOOKS = [COMMIT, PUSH]

const rules = (drift: { rule: string }[]) => drift.map((found) => found.rule)

describe('hookDrift', () => {
  it('is silent when every step is placed, each stage has its hook and the hooks only call the runner', () => {
    expect(hookDrift(WORKFLOW, CHECKS, HOOKS)).toEqual([])
  })

  it('refuses a CI step nobody placed', () => {
    const workflow = `${WORKFLOW}      - run: pnpm knip\n`
    expect(rules(hookDrift(workflow, CHECKS, HOOKS))).toEqual(['unplaced-ci-step'])
  })

  it('refuses a check CI does not run, including one whose arguments differ', () => {
    const checks: Check[] = [...CHECKS.slice(0, 2), { run: 'dedupe', stage: 'pre-commit' }]
    expect(rules(hookDrift(WORKFLOW, checks, HOOKS))).toEqual([
      'unplaced-ci-step',
      'check-not-in-ci',
    ])
  })

  it('refuses a CI-only check with no reason', () => {
    const checks: Check[] = [
      { ...CHECKS[0], stage: 'ci-only', because: ' ' } as Check,
      ...CHECKS.slice(1),
    ]
    expect(rules(hookDrift(WORKFLOW, checks, HOOKS))).toEqual(['ci-only-without-reason'])
  })

  it('refuses a stage with no hook file', () => {
    expect(rules(hookDrift(WORKFLOW, CHECKS, [COMMIT]))).toEqual(['hook-missing'])
  })

  it("refuses a hook that runs another stage's checks, or none", () => {
    const other = { path: '.githooks/pre-push', text: 'exec pnpm -s checks pre-commit\n' }
    expect(rules(hookDrift(WORKFLOW, CHECKS, [COMMIT, other]))).toEqual(['hook-skips-own-stage'])
    const none = { path: '.githooks/pre-push', text: '#!/bin/sh\nexit 0\n' }
    expect(rules(hookDrift(WORKFLOW, CHECKS, [COMMIT, none]))).toEqual(['hook-skips-own-stage'])
  })

  it('refuses a hook that runs a tool itself', () => {
    const hook = { path: '.githooks/pre-commit', text: 'pnpm exec prettier --check .\n' }
    expect(rules(hookDrift(WORKFLOW, CHECKS, [hook, PUSH]))).toEqual([
      'hook-skips-own-stage',
      'hook-runs-directly',
    ])
  })

  it('refuses a tool chained onto the runner', () => {
    const hook = {
      path: '.githooks/pre-commit',
      text: 'exec pnpm -s checks pre-commit && eslint .\n',
    }
    expect(rules(hookDrift(WORKFLOW, CHECKS, [hook, PUSH]))).toEqual([
      'hook-skips-own-stage',
      'hook-runs-directly',
    ])
  })

  it('refuses node, sh or bash running a script, and lets node read its own version', () => {
    for (const line of [
      'node tooling/x.ts',
      'sh tooling/x.sh',
      '  bash -c "x"',
      'x=$(node x.ts)',
    ]) {
      const helper = { path: '.githooks/_helper.sh', text: `${line}\n` }
      expect(rules(hookDrift(WORKFLOW, CHECKS, [...HOOKS, helper])), line).toEqual([
        'hook-runs-directly',
      ])
    }
    const version = {
      path: '.githooks/_node.sh',
      text: 'found=$(node -p "process.versions.node" || echo 0)\necho "$(node -v)"\n',
    }
    expect(hookDrift(WORKFLOW, CHECKS, [...HOOKS, version])).toEqual([])
  })

  it('refuses a CI step that calls pnpm in a form it cannot read', () => {
    const workflow = `${WORKFLOW}      - name: Knip\n        run: |\n          pnpm knip\n`
    expect(rules(hookDrift(workflow, CHECKS, HOOKS))).toEqual(['unreadable-ci-step'])
  })
})
