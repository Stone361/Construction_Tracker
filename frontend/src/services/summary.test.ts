import { describe, expect, it, vi } from 'vitest'
import { getCurrentSummary, parseSummary } from './summary'

const counts = {
  LAND_CLEARING: 2, FOUNDATION: 3, FRAMING: 0, MEP: 1, INTERIOR: 0, CO_READY: 4,
}

describe('current summary contract', () => {
  it('uses backend stage counts and stale IDs without recalculating attention rules', () => {
    expect(parseSummary({ stageCounts: counts, staleHouseIds: [10, 20] })).toEqual({
      stageCounts: counts, staleHouseIds: [10, 20], totalHouses: 10,
    })
  })

  it('rejects malformed counts and IDs instead of displaying invented totals', () => {
    expect(() => parseSummary({ stageCounts: { ...counts, MEP: -1 }, staleHouseIds: [] })).toThrow('invalid stage counts')
    expect(() => parseSummary({ stageCounts: counts, staleHouseIds: [10, 10] })).toThrow('invalid attention house IDs')
    expect(() => parseSummary({ stageCounts: counts, staleHouseIds: ['10'] })).toThrow('invalid attention house IDs')
  })

  it('requests the current snapshot with demo identity and no asOf parameter', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ stageCounts: counts, staleHouseIds: [10] }),
    } as Response)
    try {
      const identity = { user: 'summary-test', role: 'SITE_MANAGER' as const, community: 'Austin Council District 8' }
      await getCurrentSummary(new AbortController().signal, identity)
      expect(fetchMock).toHaveBeenCalledWith('/api/summary', expect.objectContaining({
        headers: expect.objectContaining({
          'X-User': 'summary-test', 'X-Role': 'SITE_MANAGER', 'X-Community': 'Austin Council District 8',
        }),
      }))
    } finally {
      fetchMock.mockRestore()
    }
  })
})
