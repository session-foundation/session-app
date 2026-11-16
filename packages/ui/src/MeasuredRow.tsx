import { useCallback, useEffect, type ReactNode } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'

/**
 * A row whose element and height the list keeps, to scroll to it. Its own component so the ref is
 * one function for the row's life: React detaches and attaches an inline one on every render.
 */
export function MeasuredRow({
  rowKey,
  nodes,
  onHeight,
  onGone,
  children,
}: {
  rowKey: string
  nodes: Map<string, unknown>
  onHeight: (key: string, heightPx: number) => void
  onGone: (key: string) => void
  children: ReactNode
}) {
  const attach = useCallback(
    (node: unknown) => {
      if (node === null) nodes.delete(rowKey)
      else nodes.set(rowKey, node)
    },
    [nodes, rowKey],
  )
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onHeight(rowKey, event.nativeEvent.layout.height)
    },
    [onHeight, rowKey],
  )
  useEffect(
    () => () => {
      onGone(rowKey)
    },
    [onGone, rowKey],
  )
  return (
    <View ref={attach} onLayout={onLayout}>
      {children}
    </View>
  )
}
