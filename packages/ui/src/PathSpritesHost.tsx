import { useEffect, useRef } from 'react'
import { YStack } from 'tamagui'

import type { PathSprite, PathSpriteLayer, PathSprites, PathSpritesProps } from './pathSprites'

/** One property's run over a layer's trip, as Web Animation keyframes. */
function run(
  element: HTMLElement,
  property: 'translate' | 'opacity' | 'scale',
  times: readonly number[],
  values: readonly string[],
  startAtMs: number,
  nowMs: number,
  stepped = false,
): void {
  const first = times[0] ?? 0
  const span = Math.max(1, (times[times.length - 1] ?? 0) - first)
  const animation = element.animate(
    times.map((at, i) => ({
      [property]: values[i],
      offset: (at - first) / span,
      ...(stepped ? { easing: 'steps(1, end)' } : {}),
    })),
    { duration: span, delay: startAtMs + first - nowMs, fill: 'both', easing: 'linear' },
  )
  animation.finished.catch(() => undefined)
}

function layerElement(layer: PathSpriteLayer, sprite: PathSprite, nowMs: number): HTMLElement {
  const element = document.createElement('div')
  const size = layer.r * 2
  const style = element.style
  style.position = 'absolute'
  style.left = `${-layer.r}px`
  style.top = `${-layer.r}px`
  style.width = `${size}px`
  style.height = `${size}px`
  style.borderRadius = '50%'
  style.boxSizing = 'border-box'
  style.willChange = 'translate, scale, opacity'
  if (layer.shape === 'glow') {
    // The request's colour fading out from a white heart, as the SVG gradient draws it.
    style.background = `radial-gradient(circle closest-side, white 0%, ${layer.color} 18%, transparent 100%)`
  } else {
    style.border = `${layer.borderWidth}px solid ${layer.color}`
  }
  style.translate = `${layer.xs[0] ?? 0}px ${layer.ys[0] ?? 0}px`
  style.opacity = '0'
  if (layer.times.length >= 2) {
    const points = layer.times.map((_, i) => `${layer.xs[i] ?? 0}px ${layer.ys[i] ?? 0}px`)
    run(element, 'translate', layer.times, points, sprite.startAtMs, nowMs)
  }
  if (layer.opacityTimes.length >= 2) {
    const values = layer.opacityValues.map(String)
    run(element, 'opacity', layer.opacityTimes, values, sprite.startAtMs, nowMs, layer.opacitySteps)
  } else if (layer.opacityValues[0] !== undefined) {
    style.opacity = String(layer.opacityValues[0])
  }
  if (layer.scaleTimes.length >= 2) {
    const values = layer.scaleValues.map(String)
    run(element, 'scale', layer.scaleTimes, values, sprite.startAtMs, nowMs)
  }
  return element
}

/**
 * The path screen's requests on the web, as Web Animations on plain elements: each trip handed to
 * the compositor once, so nothing renders per frame while they travel. A request already under
 * way when it arrives joins part way along: its animations start in the past.
 */
export const defaultPathSprites: PathSprites | null = function WebPathSprites({
  sprites,
  width,
  height,
}: PathSpritesProps) {
  const layer = useRef<HTMLElement | null>(null)
  const shown = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    const host = layer.current
    // jsdom has no `animate`; there the requests are simply not drawn.
    if (host === null || typeof host.animate !== 'function') return
    const ids = new Set(sprites.map((s) => s.id))
    for (const [id, element] of shown.current) {
      if (ids.has(id)) continue
      element.remove()
      shown.current.delete(id)
    }
    const nowMs = Date.now()
    for (const sprite of sprites) {
      if (shown.current.has(sprite.id)) continue
      const group = document.createElement('div')
      group.style.position = 'absolute'
      group.style.inset = '0'
      group.style.opacity = String(sprite.opacity)
      for (const l of sprite.layers) group.appendChild(layerElement(l, sprite, nowMs))
      host.appendChild(group)
      shown.current.set(sprite.id, group)
    }
  }, [sprites])
  useEffect(() => {
    const elements = shown.current
    return () => {
      for (const element of elements.values()) element.remove()
      elements.clear()
    }
  }, [])
  return (
    <YStack
      ref={layer as never}
      position="absolute"
      top={0}
      left={0}
      width={width}
      height={height}
      pointerEvents="none"
    />
  )
}
