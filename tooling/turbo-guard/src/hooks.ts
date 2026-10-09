import { HOOK_STAGES, type Check } from '@session/checks'

import { pnpmSteps } from '#src/ci'

export interface HookDrift {
  rule: string
  detail: string
}

/** The command a hook may run: the runner, which reads its checks from @session/checks. */
const RUNNER = /^\s*(exec )?pnpm (-s )?checks (pre-commit|pre-push)\s*$/
// A tool where a command starts; `node -p/-e/-v` is how _node.sh reads the version, not a check.
const TOOL =
  /(?:^\s*|[;&|(]\s*|\bexec\s+)(?:pnpm|npx|node(?!\s+-[pev]\b)|bash|sh|turbo|prettier|eslint|depcruise|tsc|vitest|knip)\b/

const stageRun = (line: string): string | undefined => RUNNER.exec(line)?.[3]

/** Where the hooks and CI's workflow disagree about which checks run. */
export function hookDrift(
  workflow: string,
  checks: readonly Check[],
  hooks: readonly { path: string; text: string }[],
): HookDrift[] {
  const { steps, unreadable } = pnpmSteps(workflow)
  const placed = new Set(checks.map((check) => check.run))
  const drift: HookDrift[] = unreadable.map((step) => ({
    rule: 'unreadable-ci-step',
    detail: `CI's ${step} runs something this guard cannot read; make it a one-line \`- run: pnpm <script>\` step`,
  }))

  for (const step of steps)
    if (!placed.has(step))
      drift.push({
        rule: 'unplaced-ci-step',
        detail: `CI runs \`pnpm ${step}\`, which tooling/checks/src/checks.ts does not place`,
      })
  for (const check of checks)
    if (!steps.includes(check.run))
      drift.push({
        rule: 'check-not-in-ci',
        detail: `tooling/checks/src/checks.ts places \`pnpm ${check.run}\`, which CI does not run`,
      })
  for (const check of checks)
    if (check.stage === 'ci-only' && check.because.trim() === '')
      drift.push({ rule: 'ci-only-without-reason', detail: `\`pnpm ${check.run}\` says no why` })

  for (const stage of HOOK_STAGES) {
    const hook = hooks.find((candidate) => candidate.path === `.githooks/${stage}`)
    if (hook === undefined)
      drift.push({
        rule: 'hook-missing',
        detail: `.githooks/${stage} does not exist, so nothing runs \`pnpm checks ${stage}\``,
      })
    else if (!hook.text.split('\n').some((line) => stageRun(line) === stage))
      drift.push({
        rule: 'hook-skips-own-stage',
        detail: `${hook.path} never runs \`pnpm checks ${stage}\``,
      })
  }

  for (const hook of hooks)
    for (const line of hook.text.split('\n'))
      if (!line.trimStart().startsWith('#') && TOOL.test(line) && stageRun(line) === undefined)
        drift.push({
          rule: 'hook-runs-directly',
          detail: `${hook.path} runs \`${line.trim()}\` itself rather than through \`pnpm checks\``,
        })

  return drift
}
