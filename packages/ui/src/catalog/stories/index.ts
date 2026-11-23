import type { AnyStory } from '../story'
import { albumChoices, albumFocus, albumLone, albumOverflow, albumRows } from './album'
import { button, buttonOnAccent, buttonSizes } from './button'
import { composerReply } from './composerReply'
import { contextMenu, contextMenuLabels } from './contextMenu'
import {
  contextMenuKeyboardPlacement,
  contextMenuPlacement,
  contextMenuSubmenuPlacement,
} from './contextMenuPlacement'
import { fileRow, fileRowOnAccent, fileRowReceived } from './fileRow'
import { keyCombo } from './keyCombo'
import { messageFrameFocus, messageFrameHighlight } from './messageFrame'
import { avatar, progressRing, radio } from './indicators'
import { messageQuote, messageQuoteAuthors, messageQuoteFiles, messageQuotePictures } from './quote'
import { scrollToLatest } from './scrollToLatest'
import { messageQuoteReplies } from './replies'
import { qrCode, qrViewer } from './qrCode'
import { pathFlow } from './pathFlow'
import { settingsRow } from './settingsRow'
import { composerNotice, dropOverlay, stagedTile, stagedTray } from './staging'
import { swipeToReply } from './swipeToReply'
import { switchStates } from './switch'
import { textScale } from './text'
import { topTabs } from './topTabs'
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
  switchStates,
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
  contextMenuLabels,
  contextMenuPlacement,
  contextMenuSubmenuPlacement,
  contextMenuKeyboardPlacement,
  qrCode,
  qrViewer,
  messageFrameFocus,
  keyCombo,
  messageQuote,
  messageQuotePictures,
  messageQuoteFiles,
  messageQuoteAuthors,
  composerReply,
  messageFrameHighlight,
  scrollToLatest,
  swipeToReply,
  messageQuoteReplies,
  pathFlow,
  topTabs,
]
