import { FileRow, type FileRowProps } from '../../FileRow'
import { defineStory } from '../story'
import { MessageFrame } from '../../MessageFrame'
import { noop } from './shared'

const PDF = { contentType: 'application/pdf', filename: 'report.pdf' } as const

const OPENS = { onOpen: noop, openLabel: 'Open' } as const

/**
 * The files of a message we are sending that are not the one uploading: nothing to press, so the
 * control's square holds a marker or nothing.
 */
const SENDING = {
  queued: { ...PDF, caption: 'Queued', state: 'queued' },
  uploaded: { ...PDF, caption: '180 kB', state: 'uploaded' },
  unsent: { ...PDF, caption: 'Not sent', state: 'unsent' },
} as const satisfies Record<string, FileRowProps>

export const fileRow = defineStory<FileRowProps>({
  component: 'fileRow',
  story: 'states',
  width: 360,
  forced: ['hover', 'focus'],
  sensitive: { rtl: true, responsive: true },
  variants: {
    idle: {
      ...PDF,
      ...OPENS,
      caption: '180 kB',
      state: 'idle',
      actionLabel: 'Download',
      onAction: noop,
    },
    fetching: {
      ...PDF,
      caption: '90 of 180 kB',
      state: 'fetching',
      progress: 0.5,
      actionLabel: 'Downloading',
      onAction: noop,
    },
    ready: { ...PDF, caption: '180 kB', state: 'ready', actionLabel: 'Export', onAction: noop },
    readyOpens: {
      ...PDF,
      ...OPENS,
      caption: '180 kB',
      state: 'ready',
      onPress: noop,
      pressLabel: 'Open',
      actionLabel: 'Export',
      onAction: noop,
    },
    failed: {
      ...PDF,
      caption: 'Failed to download',
      state: 'failed',
      actionLabel: 'Retry',
      onAction: noop,
    },
    unavailable: { ...PDF, caption: 'Attachment expired', state: 'unavailable' },
    ...SENDING,
    longName: {
      ...PDF,
      filename: 'quarterly-board-meeting-minutes-final-revised-v7.pdf',
      caption: '18.4 MB',
      state: 'idle',
      actionLabel: 'Download',
      onAction: noop,
    },
    arabicName: {
      ...PDF,
      filename: 'تقرير-الربع-الثالث.pdf',
      caption: '2 MB',
      state: 'idle',
      actionLabel: 'Download',
      onAction: noop,
    },
  },
  render: (props) => <FileRow {...props} />,
})

/** The states a row in a message's bubble takes, sent or received. */
const IN_BUBBLE = {
  idle: {
    ...PDF,
    ...OPENS,
    caption: '180 kB',
    state: 'idle',
    actionLabel: 'Download',
    onAction: noop,
  },
  fetching: {
    ...PDF,
    caption: '90 of 180 kB',
    state: 'fetching',
    progress: 0.5,
    actionLabel: 'Downloading',
    onAction: noop,
  },
  failed: {
    ...PDF,
    caption: 'Failed to download',
    state: 'failed',
    actionLabel: 'Retry',
    onAction: noop,
  },
} as const satisfies Record<string, FileRowProps>

export const fileRowOnAccent = defineStory<FileRowProps>({
  component: 'fileRow',
  story: 'onAccent',
  width: 360,
  forced: ['focus'],
  sensitive: { accent: true },
  variants: {
    idle: { ...IN_BUBBLE.idle, onAccent: true },
    fetching: { ...IN_BUBBLE.fetching, onAccent: true },
    failed: { ...IN_BUBBLE.failed, onAccent: true },
    // The bridge reports no upload progress, so an upload holds the empty ring.
    uploading: {
      ...PDF,
      caption: 'Uploading',
      state: 'fetching',
      actionLabel: 'Uploading',
      onAccent: true,
    },
    queued: { ...SENDING.queued, onAccent: true },
    uploaded: { ...SENDING.uploaded, onAccent: true },
    unsent: { ...SENDING.unsent, onAccent: true },
  },
  render: (props) => (
    <MessageFrame outgoing>
      <FileRow {...props} />
    </MessageFrame>
  ),
})

export const fileRowReceived = defineStory<FileRowProps>({
  component: 'fileRow',
  story: 'received',
  width: 360,
  forced: ['focus'],
  sensitive: { accent: true },
  variants: IN_BUBBLE,
  render: (props) => (
    <MessageFrame outgoing={false}>
      <FileRow {...props} received />
    </MessageFrame>
  ),
})
