import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Read rather than rendered: this package has no renderer to mount the screen with.
 *
 * The marker's behaviour is covered by `readMarker.test.ts`; what that cannot see is whether the
 * screen uses it. A conversation screen that never marks read looks correct in every test of the
 * screen itself, and its only symptom is an unread count on the list that never clears.
 */
const source = readFileSync(join(import.meta.dirname, '../src/ConversationScreen.tsx'), 'utf8')

describe('the conversation screen', () => {
  it('marks the conversation it shows read', () => {
    const body = source.slice(source.indexOf('function Conversation('))
    expect(body).toMatch(/useMarkReadWhileOpen\(conversationId,/)
  })
})
