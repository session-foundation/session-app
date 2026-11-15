import type { AnyStory } from '../story'
import { albumChoices, albumFocus, albumLone, albumOverflow, albumRows } from './album'
import { button, buttonOnAccent, buttonSizes } from './button'
import { contextMenu } from './contextMenu'
import { contextMenuPlacement } from './contextMenuPlacement'
import { fileRow, fileRowOnAccent, fileRowReceived } from './fileRow'
import { keyCombo } from './keyCombo'
import { avatar, progressRing, radio } from './indicators'
import { qrCode, qrViewer } from './qrCode'
import { messageFrameFocus } from './messageFrame'
import { settingsRow } from './settingsRow'
import { composerNotice, dropOverlay, stagedTile, stagedTray } from './staging'
import { textScale } from './text'
import { mediaViewer } from './viewer'

export const STORIES: readonly AnyStory[] = [
  button,
  buttonOnAccent,
  buttonSizes,
  settingsRow,
  fileRow,
  fileRowOnAccent,
  fileRowReceived,
  stagedTile,
  radio,
  avatar,
  progressRing,
  textScale,
  albumFocus,
  albumLone,
  albumRows,
  albumOverflow,
  albumChoices,
  stagedTray,
  composerNotice,
  dropOverlay,
  mediaViewer,
  contextMenu,
  contextMenuPlacement,
  qrCode,
  qrViewer,
  messageFrameFocus,
  keyCombo,
]
