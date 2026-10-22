import type { ConstructionStage, HouseSummary } from './houses'

export interface HouseFilters {
  address: string
  community: string | null
  stage: ConstructionStage | null
}

export function communityOptions(houses: HouseSummary[]): string[] {
  return [...new Set(houses.map(house => house.community).filter((value): value is string => value !== null))]
    .sort((a, b) => a.localeCompare(b))
}

export function filterHouses(houses: HouseSummary[], filters: HouseFilters): HouseSummary[] {
  const address = filters.address.trim().toLocaleLowerCase()
  return houses.filter(house =>
    (!address || house.address?.toLocaleLowerCase().includes(address)) &&
    (filters.community === null || house.community === filters.community) &&
    (filters.stage === null || house.stage === filters.stage),
  )
}
