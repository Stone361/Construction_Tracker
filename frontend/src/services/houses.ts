import { ApiError, getJson } from './apiClient'
import type { DemoIdentity } from '../app/DemoIdentityContext'

// GET /api/houses returns a bare HouseResponse[]. Keep only fields displayed
// in the map workspace; other backend fields are introduced when needed.
export type ConstructionStage = 'LAND_CLEARING' | 'FOUNDATION' | 'FRAMING' | 'MEP' | 'INTERIOR' | 'CO_READY'

export const constructionStages: ConstructionStage[] = [
  'LAND_CLEARING', 'FOUNDATION', 'FRAMING', 'MEP', 'INTERIOR', 'CO_READY',
]

export interface HouseBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface HouseQuery {
  bounds: HouseBounds
  stage: ConstructionStage | null
}

export interface HouseSummary {
  id: number
  address: string | null
  permitNo: string | null
  community: string | null
  stage: ConstructionStage | null
  lastPhotoBusinessDate: string | null
  lat: number | null
  lng: number | null
}

const stageNames: Record<ConstructionStage, string> = {
  LAND_CLEARING: 'Land clearing',
  FOUNDATION: 'Foundation',
  FRAMING: 'Framing',
  MEP: 'MEP',
  INTERIOR: 'Interior',
  CO_READY: 'CO ready',
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function photoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : null
}

function stage(value: unknown): ConstructionStage | null {
  return typeof value === 'string' && Object.hasOwn(stageNames, value)
    ? value as ConstructionStage
    : null
}

export function stageLabel(value: ConstructionStage | null): string {
  return value === null ? 'Stage unavailable' : stageNames[value]
}

export function displayPhotoDate(value: string | null): string {
  if (value === null) return 'No photo activity date'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

export function sortHousesByPhotoDate(houses: HouseSummary[]): HouseSummary[] {
  return [...houses].sort((a, b) => {
    if (a.lastPhotoBusinessDate === null) return b.lastPhotoBusinessDate === null ? a.id - b.id : 1
    if (b.lastPhotoBusinessDate === null) return -1
    return b.lastPhotoBusinessDate.localeCompare(a.lastPhotoBusinessDate) || a.id - b.id
  })
}

function coordinate(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : null
}

export function parseHouseList(data: unknown): HouseSummary[] {
  if (!Array.isArray(data)) throw new ApiError('The backend returned an unexpected house list format.')

  return data.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('id' in item) ||
        typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id <= 0) {
      throw new ApiError('The backend returned an invalid house record.')
    }
    const house = item as Record<string, unknown>
    return {
      id: house.id as number,
      address: optionalText(house.address),
      permitNo: optionalText(house.permitNo),
      community: optionalText(house.community),
      stage: stage(house.stage),
      lastPhotoBusinessDate: photoDate(house.lastPhotoBusinessDate),
      lat: coordinate(house.lat, 90),
      lng: coordinate(house.lng, 180),
    }
  })
}

export function houseListPath(query: HouseQuery): string {
  const params = new URLSearchParams()
  for (const key of ['minLat', 'maxLat', 'minLng', 'maxLng'] as const) {
    params.set(key, String(Number(query.bounds[key].toFixed(6))))
  }
  if (query.stage !== null) params.set('stage', query.stage)
  return `/api/houses?${params}`
}

export async function getHouses(query: HouseQuery, signal: AbortSignal | undefined, identity: DemoIdentity): Promise<HouseSummary[]> {
  return parseHouseList(await getJson(houseListPath(query), signal, identity))
}

export async function getCommunityNames(identity: DemoIdentity, signal?: AbortSignal): Promise<string[]> {
  const houses = parseHouseList(await getJson('/api/houses', signal, identity))
  return [...new Set(houses.map(house => house.community).filter((name): name is string => name !== null))]
    .sort((a, b) => a.localeCompare(b))
}

export function hasValidLocation(house: HouseSummary): house is HouseSummary & { lat: number; lng: number } {
  return house.lat !== null && house.lng !== null
}
