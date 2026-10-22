import { describe, expect, it } from 'vitest'
import { communityOptions, filterHouses } from './houseFilters'
import type { HouseSummary } from './houses'

function house(id: number, address: string | null, community: string | null, stage: HouseSummary['stage']): HouseSummary {
  return { id, address, community, stage, permitNo: null, lastPhotoBusinessDate: null,
    coverPhotoUrl: null, lat: 30.2, lng: -97.7 }
}

const houses = [
  house(1, '8023 NW St', 'Austin Council District 8', 'FOUNDATION'),
  house(2, '8023 SW St', 'Austin Council District 5', 'FRAMING'),
  house(3, '8110 Oak Ave', 'Austin Council District 8', 'FRAMING'),
  house(4, null, null, null),
]

describe('current map view house filters', () => {
  it('matches address number or street name without case sensitivity', () => {
    expect(filterHouses(houses, { address: ' 8023 ', community: null, stage: null }).map(house => house.id)).toEqual([1, 2])
    expect(filterHouses(houses, { address: 'sw ST', community: null, stage: null }).map(house => house.id)).toEqual([2])
  })

  it('combines area, stage and address while allowing each to be cleared independently', () => {
    const withAll = { address: '8023', community: 'Austin Council District 8', stage: 'FOUNDATION' as const }
    expect(filterHouses(houses, withAll).map(house => house.id)).toEqual([1])
    expect(filterHouses(houses, { ...withAll, community: null }).map(house => house.id)).toEqual([1])
    expect(filterHouses(houses, { ...withAll, stage: null }).map(house => house.id)).toEqual([1])
    expect(filterHouses(houses, { ...withAll, address: '' }).map(house => house.id)).toEqual([1])
    expect(filterHouses(houses, { address: '', community: null, stage: null })).toHaveLength(4)
  })

  it('uses exact real community values and excludes missing fields only when filtering them', () => {
    expect(communityOptions(houses)).toEqual(['Austin Council District 5', 'Austin Council District 8'])
    expect(filterHouses(houses, { address: '', community: 'austin council district 8', stage: null })).toEqual([])
    expect(filterHouses(houses, { address: '8023', community: null, stage: null })).not.toContain(houses[3])
  })
})
