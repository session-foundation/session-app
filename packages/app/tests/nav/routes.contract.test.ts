/**
 * Holds the three declarations of a route together.
 *
 *   routes.ts                     /c/:id           the source of truth
 *   apps/desktop  App.tsx         path="c/:id"     a react-router table
 *   apps/mobile   app/c/[id].tsx  a file on disk   expo-router's routes ARE the filesystem,
 *                                                  so nothing can generate them
 *
 * Three spellings of the same fact, in three languages, none of which can check the others.
 * This test is the thing that notices when one of them moves. It deliberately has no router
 * dependency of its own: it reads the desktop table as text and asks the filesystem about
 * the mobile one.
 *
 * Checked in both directions. Every row below has to exist on both platforms, and neither
 * platform may declare anything that is not a row - a screen reachable on desktop and not on
 * mobile is the failure this is here to catch, and it does not announce itself.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { conversationFromPath, landingFromParam, LAND_ON_PARAM, routes } from '#src/nav/routes'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')

interface RouteContract {
  /** What routes.ts builds. */
  path: string
  /** The pattern the desktop router declares. */
  desktop: string
  /** The file expo-router turns into a route. */
  mobile: string
}

const ROUTES: RouteContract[] = [
  { path: routes.home(), desktop: '', mobile: 'index.tsx' },
  { path: routes.conversation('05abc'), desktop: 'c/:id', mobile: 'c/[id].tsx' },
  { path: routes.newConversation(), desktop: 'new', mobile: 'new.tsx' },
  { path: routes.requests(), desktop: 'requests', mobile: 'requests.tsx' },
]

function declaredDesktopPaths(): string[] {
  const source = readFileSync(join(repoRoot, 'apps/desktop/src/renderer/App.tsx'), 'utf8')
  // `<Route path=` rather than `path=`, so that prose about this scrape is not scraped by it.
  return [...source.matchAll(/<Route\s+path="([^"]*)"/g)].map((match) => match[1] ?? '')
}

/** The files expo-router turns into routes: everything but its own layout conventions. */
function mobileRouteFiles(): string[] {
  const root = join(repoRoot, 'apps/mobile/app')
  const walk = (dir: string, prefix: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
  return walk(root, '').filter((file) => !file.split('/').some((part) => part.startsWith('_')))
}

/** Segment count plus literal comparison; a `:param` matches any one non-empty segment. */
function patternMatches(pattern: string, path: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return false
  return patternParts.every((part, index) => {
    const actual = pathParts[index]
    if (actual === undefined || actual.length === 0) return false
    return part.startsWith(':') ? true : part === actual
  })
}

const sorted = (values: string[]): string[] => [...values].sort()

describe('route contract', () => {
  it.each(ROUTES)('$path is declared by the desktop router', ({ path, desktop }) => {
    const declared = declaredDesktopPaths()
    expect(declared).toContain(desktop)
    expect(patternMatches(desktop, path)).toBe(true)
  })

  it.each(ROUTES)('$path has a route file in the mobile app', ({ mobile }) => {
    expect(existsSync(join(repoRoot, 'apps/mobile/app', mobile))).toBe(true)
  })

  it('declares nothing on desktop that is not a route', () => {
    expect(sorted(declaredDesktopPaths())).toEqual(sorted(ROUTES.map((r) => r.desktop)))
  })

  it('has no route file on mobile that is not a route', () => {
    expect(sorted(mobileRouteFiles())).toEqual(sorted(ROUTES.map((r) => r.mobile)))
  })

  it('builds every path as an absolute one', () => {
    // A path that did not start with "/" would concatenate into nonsense the first time a
    // driver applied a prefix to it.
    for (const { path } of ROUTES) expect(path.startsWith('/')).toBe(true)
  })

  it('reads a conversation id back out of the path it built', () => {
    // Community ids carry slashes, so the round trip has to survive encoding.
    for (const id of ['05abc', 'community:https://open.getsession.org/room']) {
      expect(conversationFromPath(routes.conversation(id))).toBe(id)
    }
  })

  it('puts the message to land on in the query, and reads it back', () => {
    const path = routes.conversation('05abc', 42)
    const [pathname = '', search = ''] = path.split('?')
    expect(conversationFromPath(pathname)).toBe('05abc')
    expect(landingFromParam(new URLSearchParams(search).get(LAND_ON_PARAM))).toBe(42)
    expect(routes.conversation('05abc')).not.toContain('?')
  })

  it('lands on nothing for a value that is not a message id', () => {
    for (const value of [undefined, null, '', '-1', '1.5', 'abc', '4e2'])
      expect(landingFromParam(value)).toBe(undefined)
    expect(landingFromParam('0')).toBe(0)
  })

  it('finds no conversation in a path that is not one', () => {
    expect(conversationFromPath('/')).toBe(null)
    expect(conversationFromPath('/settings')).toBe(null)
  })

  it('guards the guard', () => {
    // If patternMatches accepted anything, every assertion above would pass vacuously.
    expect(patternMatches('c/:id', '/c/05abc')).toBe(true)
    expect(patternMatches('c/:id', '/c/05abc/extra')).toBe(false)
    expect(patternMatches('c/:id', '/settings')).toBe(false)
    expect(patternMatches('requests', '/settings')).toBe(false)
  })
})
