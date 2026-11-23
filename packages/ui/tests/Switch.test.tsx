import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Switch } from '#src/Switch'

import { renderInUI } from './support/render'

describe('Switch', () => {
  it('is a switch named for what it switches, checked when on', () => {
    renderInUI(
      <Switch value onValueChange={vi.fn()} accessibilityLabel="Read receipts" testID="s" />,
    )
    const control = screen.getByRole('switch', { name: 'Read receipts' })
    expect(control).toHaveProperty('checked', true)
  })

  it('asks for the other value when pressed', () => {
    const changed = vi.fn()
    renderInUI(
      <Switch
        value={false}
        onValueChange={changed}
        accessibilityLabel="Read receipts"
        testID="s"
      />,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Read receipts' }))
    expect(changed).toHaveBeenCalledWith(true)
  })

  it('asks for nothing while disabled', () => {
    const changed = vi.fn()
    renderInUI(
      <Switch
        value={false}
        disabled
        onValueChange={changed}
        accessibilityLabel="Read receipts"
        testID="s"
      />,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Read receipts' }))
    expect(changed).not.toHaveBeenCalled()
  })
})
