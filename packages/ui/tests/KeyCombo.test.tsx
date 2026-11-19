import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { KeyCombo } from '#src/KeyCombo'

import { renderInUI } from './support/render'

describe('a key combination', () => {
  it('names an arrow drawn as an icon, as a screen reader reads the character', () => {
    renderInUI(<KeyCombo keys={['up']} names="pc" testID="up" />)
    expect(screen.getByRole('img', { name: '↑' })).toBeTruthy()
  })

  it('draws left and right as icons too', () => {
    renderInUI(<KeyCombo keys={['left']} names="pc" testID="left" />)
    renderInUI(<KeyCombo keys={['right']} names="pc" testID="right" />)
    expect(screen.getByRole('img', { name: '←' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '→' })).toBeTruthy()
  })

  it('leaves a key drawn as a word to its text', () => {
    renderInUI(<KeyCombo keys={['mod', 'slash']} names="mac" testID="open" />)
    expect(screen.queryAllByRole('img')).toEqual([])
    expect(screen.getByTestId('open').textContent).toBe('⌘/')
  })
})
