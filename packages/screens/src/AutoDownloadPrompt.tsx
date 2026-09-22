import { tr } from '@session/localization'
import { useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Button, Modal } from '@session/ui'

import { LocalizedText } from './LocalizedText'

/**
 * Asked the first time someone fetches an attachment in a conversation, and never again.
 *
 * Both answers are recorded, `no` included: calling the setter is what marks the question as
 * asked, and a client that stored "no" as "not asked" would put this on screen for ever.
 *
 * **A dialog rather than an overlay inside the screen.** Drawn as an absolutely positioned cover it
 * resolved its offsets against whichever ancestor happened to be a containing block -- every
 * react-native view is one, so it was right on a phone, and on the web a stack is static unless it
 * says otherwise, so it escaped to the page in the desktop app. `Modal` puts up its own surface and
 * there is nothing left to resolve against.
 *
 * No cross, and not dismissible by a tap outside: this asks a question, and a third unlabelled
 * answer beside Yes and No is not one of the choices.
 */
export function AutoDownloadPrompt({
  open,
  conversationId,
  conversationName,
  onAnswered,
}: {
  open: boolean
  conversationId: string
  conversationName: string
  onAnswered: () => void
}) {
  const actions = useSessionActions()

  function answer(mode: 'all' | 'none'): void {
    onAnswered()
    void actions.setAutoDownload(conversationId, mode)
  }

  return (
    <Modal
      open={open}
      // Unreachable while `showClose` is false, which turns dismissal off with it - but a dialog
      // closed some other way has still been answered, and no is the answer that changes least.
      onClose={() => {
        answer('none')
      }}
      title={tr('attachmentsAutoDownloadModalTitle')}
      closeLabel={tr('no')}
      showClose={false}
      testID={ELEMENT.conversation.autoDownloadPrompt}
      closeTestID={ELEMENT.conversation.autoDownloadNo}
      actions={
        <>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            testID={ELEMENT.conversation.autoDownloadYes}
            onPress={() => {
              answer('all')
            }}
          >
            {tr('yes')}
          </Button>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            testID={ELEMENT.conversation.autoDownloadNo}
            onPress={() => {
              answer('none')
            }}
          >
            {tr('no')}
          </Button>
        </>
      }
    >
      <LocalizedText
        text={tr('attachmentsAutoDownloadModalDescription', {
          conversation_name: conversationName,
        })}
      />
    </Modal>
  )
}
