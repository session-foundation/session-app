import { describe, expect, it } from 'vitest'

import { formatConversationTime, type ExplicitDateFormat } from '#src/conversationTime'

/**
 * Every timestamp here is built from local fields, so the cases mean the same calendar days in
 * whatever zone the suite runs in. Wednesday 16 August 2023, 14:30.
 */
const NOW = new Date(2023, 7, 16, 14, 30).getTime()
const at = (day: number, hour: number, minute = 0, month = 7, year = 2023): number =>
  new Date(year, month, day, hour, minute).getTime()

const US = { locale: 'en-US' } as const
const GB = { locale: 'en-GB' } as const

describe('today', () => {
  it('shows the time alone', () => {
    expect(formatConversationTime(at(16, 6), NOW, US)).toBe('6:00 AM')
    expect(formatConversationTime(at(16, 6), NOW, GB)).toBe('06:00')
  })

  it('starts at midnight', () => {
    expect(formatConversationTime(at(16, 0, 0), NOW, US)).toBe('12:00 AM')
    expect(formatConversationTime(at(16, 0, 0), NOW, GB)).toBe('00:00')
  })

  it('includes a moment later today, which a sender running fast can produce', () => {
    expect(formatConversationTime(at(16, 23, 59), NOW, US)).toBe('11:59 PM')
  })

  it('pads a 24-hour clock’s hour at every hour, not only some', () => {
    // `hour: numeric` alone gives en-GB "0:05" here and "18:00" in the evening.
    expect(formatConversationTime(at(16, 0, 5), NOW, GB)).toBe('00:05')
    expect(formatConversationTime(at(16, 9, 5), NOW, GB)).toBe('09:05')
  })
})

describe('the six days before today', () => {
  it('shows the weekday and the time from one minute before midnight', () => {
    expect(formatConversationTime(at(15, 23, 59), NOW, US)).toBe('Tue 11:59 PM')
  })

  it('reaches back six days', () => {
    expect(formatConversationTime(at(10, 6), NOW, US)).toBe('Thu 6:00 AM')
    expect(formatConversationTime(at(10, 0, 0), NOW, GB)).toBe('Thu 00:00')
  })

  it('stops before the same weekday a week ago, which would read as today', () => {
    expect(formatConversationTime(at(9, 23, 59), NOW, US)).toBe('8/9/23')
    expect(formatConversationTime(at(9, 23, 59), NOW, GB)).toBe('09/08/2023')
  })

  it('counts calendar days rather than elapsed hours', () => {
    // Five minutes after midnight, one minute before the previous midnight: a day apart by the
    // calendar, barely more than 24 hours by the clock.
    const justAfterMidnight = at(16, 0, 5)
    expect(formatConversationTime(at(15, 0, 4), justAfterMidnight, US)).toBe('Tue 12:04 AM')
    expect(formatConversationTime(at(9, 0, 6), justAfterMidnight, US)).toBe('8/9/23')
  })

  it('crosses a month and a year', () => {
    const newYear = new Date(2024, 0, 2, 9, 0).getTime()
    expect(formatConversationTime(at(31, 18, 0, 11, 2023), newYear, US)).toBe('Sun 6:00 PM')
    expect(formatConversationTime(at(26, 18, 0, 11, 2023), newYear, US)).toBe('12/26/23')
  })
})

describe('older, or on a later day than now', () => {
  it('shows the locale’s short date', () => {
    expect(formatConversationTime(at(19, 18, 0, 7, 2022), NOW, US)).toBe('8/19/22')
    expect(formatConversationTime(at(19, 18, 0, 7, 2022), NOW, GB)).toBe('19/08/2022')
  })

  it('shows a date for a day ahead of now rather than a weekday that has not happened', () => {
    expect(formatConversationTime(at(17, 9), NOW, US)).toBe('8/17/23')
  })
})

describe('the clock override', () => {
  it('draws 24-hour time in a 12-hour locale', () => {
    const options = { ...US, timeFormat: '24h' } as const
    expect(formatConversationTime(at(16, 18, 0), NOW, options)).toBe('18:00')
    expect(formatConversationTime(at(16, 0, 5), NOW, options)).toBe('00:05')
    expect(formatConversationTime(at(14, 18, 0), NOW, options)).toBe('Mon 18:00')
  })

  it('draws 12-hour time in a 24-hour locale', () => {
    const options = { ...GB, timeFormat: '12h' } as const
    expect(formatConversationTime(at(16, 18, 0), NOW, options)).toBe('6:00 pm')
    expect(formatConversationTime(at(16, 0, 5), NOW, options)).toBe('12:05 am')
    expect(formatConversationTime(at(14, 18, 0), NOW, options)).toBe('Mon 6:00 pm')
  })

  it('leaves a date alone', () => {
    expect(formatConversationTime(at(19, 18, 0, 7, 2022), NOW, { ...US, timeFormat: '24h' })).toBe(
      '8/19/22',
    )
  })
})

describe('the date override', () => {
  // 9 August 2023 and 19 August 2022: one has single-digit fields to pad, the other does not.
  const cases: Record<ExplicitDateFormat, readonly [string, string]> = {
    'M/D/YY': ['8/9/23', '8/19/22'],
    'D/M/YY': ['9/8/23', '19/8/22'],
    'DD/MM/YYYY': ['09/08/2023', '19/08/2022'],
    'DD.MM.YYYY': ['09.08.2023', '19.08.2022'],
    'DD-MM-YYYY': ['09-08-2023', '19-08-2022'],
    'YYYY/M/D': ['2023/8/9', '2022/8/19'],
    'YYYY.M.D': ['2023.8.9', '2022.8.19'],
    'YYYY-M-D': ['2023-8-9', '2022-8-19'],
  }

  for (const [dateFormat, [early, late]] of Object.entries(cases) as Array<
    [ExplicitDateFormat, readonly [string, string]]
  >) {
    it(`lays a date out as ${dateFormat}`, () => {
      expect(formatConversationTime(at(9, 8), NOW, { ...US, dateFormat })).toBe(early)
      expect(formatConversationTime(at(19, 18, 0, 7, 2022), NOW, { ...GB, dateFormat })).toBe(late)
    })
  }

  it('pads a two-digit year from the first decade of a century', () => {
    expect(formatConversationTime(at(1, 8, 0, 0, 2005), NOW, { ...US, dateFormat: 'M/D/YY' })).toBe(
      '1/1/05',
    )
  })

  it('leaves today and this week alone', () => {
    const options = { ...US, dateFormat: 'YYYY-M-D' } as const
    expect(formatConversationTime(at(16, 6), NOW, options)).toBe('6:00 AM')
    expect(formatConversationTime(at(14, 6), NOW, options)).toBe('Mon 6:00 AM')
  })
})

describe('a locale other than English', () => {
  it('uses its own words, clock and date order', () => {
    const de = { locale: 'de-DE' } as const
    expect(formatConversationTime(at(16, 0, 5), NOW, de)).toBe('00:05')
    expect(formatConversationTime(at(14, 18, 0), NOW, de)).toBe('Mo., 18:00')
    expect(formatConversationTime(at(19, 18, 0, 7, 2022), NOW, de)).toBe('19.08.22')
  })

  it('still takes the overrides', () => {
    const fr = { locale: 'fr-FR', timeFormat: '12h', dateFormat: 'YYYY-M-D' } as const
    expect(formatConversationTime(at(14, 18, 0), NOW, fr)).toMatch(/^lun\. 6:00\sPM$/)
    expect(formatConversationTime(at(19, 18, 0, 7, 2022), NOW, fr)).toBe('2022-8-19')
  })
})

describe('the defaults', () => {
  it('follow the runtime’s own locale and clock', () => {
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(
      at(19, 18, 0, 7, 2022),
    )
    expect(formatConversationTime(at(19, 18, 0, 7, 2022), NOW)).toBe(expected)
  })

  it('are the same as asking for the system’s', () => {
    for (const timestamp of [at(16, 6), at(14, 6), at(19, 18, 0, 7, 2022)])
      expect(formatConversationTime(timestamp, NOW, US)).toBe(
        formatConversationTime(timestamp, NOW, {
          ...US,
          timeFormat: 'system',
          dateFormat: 'system',
        }),
      )
  })
})
