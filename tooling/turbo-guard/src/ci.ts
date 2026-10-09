/**
 * Reading CI's own configuration, so the guard checks what CI runs rather than a list that drifts.
 *
 * Deliberately line-based rather than a YAML parse: the steps it reads are one-line, and any other
 * `run:` beyond git, echo and the shell around them is reported rather than missed.
 */

/** A line that is not a check: git plumbing, a message, exit, and the shell control around them. */
const HARMLESS =
  /^(?:(?:if|elif|while|until|then|else|do)\s+|!\s+)*(?:git|echo|exit|fi|then|else|done)\b/

/** The lines of a YAML block scalar opened on `lines[index]`, a key indented by `indent`. */
function blockBelow(lines: readonly string[], index: number, indent: number): string[] {
  const block: string[] = []
  for (const line of lines.slice(index + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= indent) break
    block.push(line)
  }
  return block
}

export interface PnpmSteps {
  /** What follows `pnpm ` in each one-line `run: pnpm ...` step. */
  steps: string[]
  /**
   * Every other `run:` that is not plainly harmless, which the rules reading `steps` would not
   * see.
   */
  unreadable: string[]
}

export function pnpmSteps(workflow: string): PnpmSteps {
  const lines = workflow.split('\n')
  const found: PnpmSteps = { steps: [], unreadable: [] }
  for (const [index, line] of lines.entries()) {
    const run = /^(\s*)(?:- )?run:\s*(.*?)\s*$/.exec(line)
    if (run === null) continue
    const indent = (run[1] as string).length
    const value = run[2] as string
    const oneLine = /^pnpm (.+)$/.exec(value)
    if (oneLine !== null) {
      found.steps.push(oneLine[1] as string)
      continue
    }
    const script = /^[|>]/.test(value) ? blockBelow(lines, index, indent) : [value]
    if (script.some((text) => text.trim() !== '' && !HARMLESS.test(text.trim())))
      found.unreadable.push(`line ${String(index + 1)}: ${line.trim()}`)
  }
  return found
}

/** The turbo tasks a workflow's `pnpm <script>` steps start, through the root package's scripts. */
export function turboTasksIn(workflow: string, scripts: Record<string, string>): string[] {
  const tasks = new Set<string>()
  for (const step of pnpmSteps(workflow).steps) {
    const command = /^[\w:-]+$/.test(step) ? scripts[step] : undefined
    const turbo = command === undefined ? null : /^turbo (?:run )?(.+)$/.exec(command)
    if (turbo !== null) for (const task of (turbo[1] as string).split(/\s+/)) tasks.add(task)
  }
  return [...tasks]
}

/**
 * Submodules the workflow leaves out, which is everything it does not name in a
 * `git submodule update --init` step.
 *
 * What makes the guard's answer CI's rather than the developer's: a tree with libsession checked
 * out has every input present, and would pass exactly the configuration that failed on #34.
 */
export function absentSubmodules(gitmodules: string, workflow: string): string[] {
  const all = [...gitmodules.matchAll(/^\s*path\s*=\s*(\S+)\s*$/gm)].map((m) => m[1] as string)
  const initialised = [...workflow.matchAll(/git submodule update --init[^\n]*$/gm)].flatMap((m) =>
    m[0].split(/\s+/).filter((word) => all.includes(word)),
  )
  return all.filter((path) => !initialised.includes(path))
}
