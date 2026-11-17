import type { Conversation } from '@session/client'
import { tr } from '@session/localization'

/**
 * As much of a conversation as naming it needs: its id, and whatever names it has yet.
 *
 * The names are optional so a screen that has the id and not the conversation - the moment a route
 * opens one the store has not hydrated - can ask the same question.
 */
type Named = Pick<Conversation, 'id'> & {
  nickname?: string | undefined
  displayName?: string | undefined
  noteToSelf?: boolean | undefined
}

/**
 * What to call a conversation on screen.
 *
 * Note to Self is called that whatever your own name is, as in all three current clients; any
 * other conversation takes the name of whoever it is with (`conversationAvatarName`).
 */
export function conversationTitle(conversation: Named): string {
  if (conversation.noteToSelf === true) return tr('noteToSelf')
  return conversationAvatarName(conversation)
}

/**
 * The name a conversation's avatar takes its initials from: the person's, so Note to Self shows
 * your own initials, as your own avatar does elsewhere, rather than those of "Note to Self".
 *
 * Nickname, then display name, then the account ID, and a name that is only whitespace counts as
 * no name at all. libsession reports an empty string for a display name until the other side's
 * profile arrives, and a nickname set to blanks is a name nobody can read - left to stand, either
 * draws a row with an avatar, a snippet, and nothing saying who wrote it.
 *
 * The trimmed value is what comes back, since the untrimmed one is only ever leading space in a
 * row that has already been laid out.
 */
export function conversationAvatarName(conversation: Named): string {
  const nickname = conversation.nickname?.trim() ?? ''
  if (nickname.length > 0) return nickname

  const displayName = conversation.displayName?.trim() ?? ''
  if (displayName.length > 0) return displayName

  return shortenAccountId(conversation.id)
}

/**
 * Both ends of an account ID, which is all of it anybody reads.
 *
 * Deliberately the same shape as session-desktop's `PubKey.shorten`: four characters each side,
 * three dots, and the parentheses that tell a reader this is an ID standing in for a name
 * rather than a name somebody chose. An ID shortened two ways across two clients is one that
 * cannot be compared against the other device's screen, which is the only thing it is for.
 */
function shortenAccountId(id: string, keepCharacters = 4): string {
  if (id.length <= keepCharacters * 2) return id
  return `(${id.slice(0, keepCharacters)}...${id.slice(-keepCharacters)})`
}
