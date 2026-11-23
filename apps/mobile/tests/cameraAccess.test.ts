import { describe, expect, it } from 'vitest'

import { readCameraAccess } from '#src/cameraAccess'

describe('reading the camera permission', () => {
  it('is unknown until the OS has been asked', () => {
    expect(readCameraAccess(null)).toBe('unknown')
    expect(readCameraAccess({ granted: false, canAskAgain: true, status: 'undetermined' })).toBe(
      'unknown',
    )
  })

  it('tells a refusal that can be asked again from one only Settings can undo', () => {
    expect(readCameraAccess({ granted: false, canAskAgain: true, status: 'denied' })).toBe('denied')
    expect(readCameraAccess({ granted: false, canAskAgain: false, status: 'denied' })).toBe(
      'blocked',
    )
  })

  it('is granted when the OS says so', () => {
    expect(readCameraAccess({ granted: true, canAskAgain: true, status: 'granted' })).toBe(
      'granted',
    )
  })
})
