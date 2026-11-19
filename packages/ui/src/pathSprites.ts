import { createContext, useContext, type ComponentType } from 'react'

/**
 * One layer of a request on the path screen, as plain data a platform animator can run without
 * hearing from JavaScript again: where it is over its trip, when it shows and how large it is.
 * Times are milliseconds into the trip; positions are its centre in the drawing.
 */
export interface PathSpriteLayer {
  /** A glow is the request's colour fading out from a white heart; a ring is a circle's outline. */
  shape: 'glow' | 'ring'
  color: string
  r: number
  /** A ring's line width. */
  borderWidth: number
  /** Where it is at each of `times`, moving in straight runs between them. */
  times: number[]
  xs: number[]
  ys: number[]
  /** Its opacity at each of `opacityTimes`: held until the next if `opacitySteps`, else eased. */
  opacityTimes: number[]
  opacityValues: number[]
  opacitySteps: boolean
  /** Its scale at each of `scaleTimes`, in straight runs; empty for none. */
  scaleTimes: number[]
  scaleValues: number[]
}

/** A request on its trip, from `startAtMs` (the epoch) for `endMs`. */
export interface PathSprite {
  id: string
  startAtMs: number
  endMs: number
  opacity: number
  layers: PathSpriteLayer[]
}

export interface PathSpritesProps {
  sprites: readonly PathSprite[]
  width: number
  height: number
}

/**
 * What moves the requests on the path screen where the platform can run their animation itself,
 * off the app's threads: injected on a phone because a native view may only be reached from the
 * app. Without one the web has Web Animations of its own (`PathSpritesHost`), and a phone falls
 * back to React Native's native driver, which costs a props update per request every frame.
 */
export type PathSprites = ComponentType<PathSpritesProps>

const PathSpritesContext = createContext<PathSprites | null>(null)

export const PathSpritesProvider = PathSpritesContext.Provider

/** The animator the app injected, or null where it injects none (desktop). */
export function usePathSprites(): PathSprites | null {
  return useContext(PathSpritesContext)
}
