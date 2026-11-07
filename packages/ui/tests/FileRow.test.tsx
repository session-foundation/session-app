import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ATTACHMENT_ROW_IDS as IDS, fileRow, type FileRowSituation } from '@session/expectations'

import { fileLeadHeight, type FileRowState } from '#src/fileRowState'
import { FileRow, type FileRowProps } from '#src/FileRow'

import { byId, declared, nodeOf } from '@session/render-tier'
import { renderInUI } from './support/render'

const TEST_IDS = {
  row: IDS.row,
  name: IDS.name,
  caption: IDS.caption,
  lead: IDS.lead,
  thumbnail: IDS.thumbnail,
  action: IDS.download,
}

const CONTROL_NAME: Record<FileRowState, string | undefined> = {
  idle: 'Download',
  fetching: 'Downloading',
  ready: 'Export',
  failed: 'Retry',
  unavailable: undefined,
  queued: undefined,
  uploaded: undefined,
  unsent: undefined,
}

/** A picture's row, whose lead square opens it once it is here and fetches it before. */
function pictureRow(state: FileRowState, over: Partial<FileRowProps> = {}): FileRowProps {
  const verb = state === 'ready' ? 'Open' : state === 'fetching' ? undefined : CONTROL_NAME[state]
  return {
    filename: 'harbour.jpg',
    contentType: 'image/jpeg',
    caption: '2 MB',
    state,
    thumbnail: {
      uri: 'file:///harbour.jpg',
      fetchesOnOpen: state === 'idle' || state === 'failed',
    },
    onOpen: () => {},
    openLabel: verb,
    onPress: verb === undefined ? undefined : () => {},
    pressLabel: verb,
    actionLabel: CONTROL_NAME[state],
    onAction: () => {},
    testIDs: TEST_IDS,
    ...over,
  }
}

function situation(props: FileRowProps): FileRowSituation {
  return {
    filename: props.filename,
    format: 'JPG',
    caption: props.caption,
    state: props.state,
    rowVerb: props.onPress === undefined ? undefined : props.pressLabel,
    leadOpens: props.onOpen !== undefined,
    leadVerb: props.openLabel,
    controlName: props.actionLabel,
  }
}

const STATES: FileRowState[] = [
  'idle',
  'fetching',
  'ready',
  'failed',
  'unavailable',
  'queued',
  'uploaded',
  'unsent',
]

describe('a file row, as a screen reader reaches it on the desktop', () => {
  it.each(STATES)('is what its parts are expected to be while %s', (state) => {
    const props = pictureRow(state)
    renderInUI(<FileRow {...props} />)
    const expected = fileRow(situation(props))
    expect(nodeOf(IDS.row)).toMatchObject(expected.row.desktop!)
    expect(nodeOf(IDS.lead)).toMatchObject(expected.lead.desktop!)
    expect(nodeOf(IDS.name)).toMatchObject(expected.name.desktop!)
    expect(nodeOf(IDS.caption)).toMatchObject(expected.caption.desktop!)
    if (expected.control.desktop === null) expect(nodeOf(IDS.download)).toBeNull()
    else expect(nodeOf(IDS.download)).toMatchObject(expected.control.desktop)
  })

  it('carries no description or disabled state on the row, which is no button', () => {
    renderInUI(<FileRow {...pictureRow('fetching')} />)
    const row = byId(IDS.row)
    for (const attribute of ['role', 'aria-label', 'aria-description', 'aria-disabled', 'tabindex'])
      expect(row.hasAttribute(attribute)).toBe(false)
  })

  it('carries the lead square’s id before any picture is in it', () => {
    renderInUI(<FileRow {...pictureRow('idle', { thumbnail: { uri: undefined } })} />)
    expect(nodeOf(IDS.lead)).not.toBeNull()
    expect(nodeOf(IDS.thumbnail)).toBeNull()
  })

  it('carries the picture’s id once it has one', () => {
    renderInUI(<FileRow {...pictureRow('ready')} />)
    expect(byId(IDS.lead).querySelector(`[data-testid="${IDS.thumbnail}"]`)).not.toBeNull()
  })
})

describe('a press on a file row', () => {
  it('is the row’s, the lead square’s or the control’s, never two of them', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    const onOpen = vi.fn()
    const onAction = vi.fn()
    renderInUI(<FileRow {...pictureRow('ready', { onPress, onOpen, onAction })} />)
    await user.click(byId(IDS.download))
    expect([
      onPress.mock.calls.length,
      onOpen.mock.calls.length,
      onAction.mock.calls.length,
    ]).toEqual([0, 0, 1])
    await user.click(byId(IDS.lead))
    expect([
      onPress.mock.calls.length,
      onOpen.mock.calls.length,
      onAction.mock.calls.length,
    ]).toEqual([0, 1, 1])
    await user.click(byId(IDS.name))
    expect([
      onPress.mock.calls.length,
      onOpen.mock.calls.length,
      onAction.mock.calls.length,
    ]).toEqual([1, 1, 1])
  })

  it('takes the pointer on the row where the row presses', () => {
    renderInUI(<FileRow {...pictureRow('ready')} />)
    expect(declared(byId(IDS.row)).cursor).toBe('pointer')
  })

  it('reaches the lead square and then the control from the keyboard, and never the row', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onAction = vi.fn()
    renderInUI(<FileRow {...pictureRow('ready', { onOpen, onAction })} />)
    await user.tab()
    expect(document.activeElement).toBe(byId(IDS.lead))
    await user.keyboard('{Enter}')
    await user.tab()
    expect(document.activeElement).toBe(byId(IDS.download))
    await user.keyboard(' ')
    await user.tab()
    expect(document.activeElement).toBe(document.body)
    expect([onOpen.mock.calls.length, onAction.mock.calls.length]).toEqual([1, 1])
  })

  it('takes no stop for an absent control', async () => {
    const user = userEvent.setup()
    renderInUI(
      <FileRow {...pictureRow('unavailable', { onOpen: undefined, thumbnail: undefined })} />,
    )
    await user.tab()
    expect(document.activeElement).toBe(document.body)
  })

  it('presses nothing on the control or the lead square while fetching', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onAction = vi.fn()
    renderInUI(<FileRow {...pictureRow('fetching', { onOpen, onAction })} />)
    await user.click(byId(IDS.download))
    await user.click(byId(IDS.lead))
    expect([onOpen.mock.calls.length, onAction.mock.calls.length]).toEqual([0, 0])
  })

  it.each([IDS.lead, IDS.download])('keeps focus on %s when a fetch starts and ends', (id) => {
    const { rerender } = renderInUI(<FileRow {...pictureRow('idle')} />)
    const focused = byId(id)
    focused.focus()
    rerender(<FileRow {...pictureRow('fetching')} />)
    expect(document.activeElement).toBe(focused)
    expect(focused.getAttribute('aria-disabled')).toBe('true')
    rerender(<FileRow {...pictureRow('ready')} />)
    expect(document.activeElement).toBe(focused)
    // Android keeps a disabled state whose prop is dropped rather than cleared.
    expect(focused.getAttribute('aria-disabled')).toBe('false')
  })
})

describe('a file row’s layout', () => {
  it('holds the lead at the height fileRowHeight counts, inside the padding it counts', () => {
    // `getItemLayout` places rows by that constant, so a row that measured differently would
    // scroll to the wrong place.
    renderInUI(<FileRow {...pictureRow('idle')} />)
    expect(declared(byId(IDS.lead).parentElement!)).toMatchObject({
      height: `${String(fileLeadHeight(1))}px`,
    })
    expect(declared(byId(IDS.row))).toMatchObject({
      'padding-top': 'var(--t-space-xs)',
      'padding-bottom': 'var(--t-space-xs)',
    })
  })
})

describe('a failed file row’s words', () => {
  it('keep the name and the caption in their usual inks, with only the retry in red', () => {
    renderInUI(<FileRow {...pictureRow('failed')} />)
    expect({
      name: declared(byId(IDS.name).querySelector('span:last-child')!).color,
      caption: declared(byId(IDS.caption)).color,
    }).toEqual({ name: 'var(--textPrimary)', caption: 'var(--textSecondary)' })
    expect(byId(IDS.download).innerHTML).toContain('var(--dangerColor)')
  })

  it('draw the retry in the body text on a bubble someone else sent', () => {
    renderInUI(<FileRow {...pictureRow('failed', { received: true })} />)
    expect(byId(IDS.download).innerHTML).toContain('var(--textPrimary)')
    expect(byId(IDS.download).innerHTML).not.toContain('var(--dangerColor)')
    expect(declared(byId(IDS.caption)).color).toBe('var(--textSecondary)')
  })
})
