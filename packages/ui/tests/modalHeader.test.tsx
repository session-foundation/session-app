import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ModalStackProvider, useModals, type Modals } from '#src/ModalsProvider'
import { ModalStackRoot } from '#src/ModalStackRoot'
import { Text } from '#src/Text'

import { renderInUI } from './support/render'

let modals: Modals | null = null

function Capture() {
  modals = useModals()
  return null
}

function open(): Modals {
  renderInUI(
    <ModalStackProvider>
      <ModalStackRoot closeLabel="Close" backLabel="Back">
        <Capture />
      </ModalStackRoot>
    </ModalStackProvider>,
  )
  if (modals === null) throw new Error('no modal stack')
  return modals
}

/** A screen's header belongs to that screen: drawn while it shows, and gone under another. */
describe("a modal screen's header", () => {
  it('is drawn with its screen, and not over a screen pushed without one', () => {
    const stack = open()
    act(() => {
      stack.present({
        initial: {
          title: 'Developer Settings',
          header: () => <Text testID="header">Restart needed</Text>,
          render: () => <Text testID="body">Flags</Text>,
        },
      })
    })
    expect(screen.getByTestId('header')).toBeTruthy()

    act(() => {
      stack.push({ title: 'Other', render: () => <Text testID="other">Other</Text> })
    })
    expect(screen.queryByTestId('header')).toBeNull()

    act(() => {
      stack.back()
    })
    expect(screen.getByTestId('header')).toBeTruthy()
  })
})
