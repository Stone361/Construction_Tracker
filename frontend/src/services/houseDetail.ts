import { ApiError, getJson } from './apiClient'
import type { ConstructionStage } from './houses'
import { constructionStages } from './houses'

export interface HouseDetail {
  id: number
  permitNo: string | null
  address: string | null
  community: string | null
  lat: number | null
  lng: number | null
  stage: ConstructionStage | null
  coverPhotoId: number | null
  sourceType: 'MANUAL' | 'PUBLIC_DATA' | null
  sourceUrl: string | null
  sourceFetchedAt: string | null
  createdAt: string | null
  createdBusinessDate: string | null
  createdBy: string | null
  updatedAt: string | null
  photos: HousePhoto[]
}

export interface HousePhoto {
  id: number
  stage: ConstructionStage | null
  takenAt: string | null
  uploadedAt: string | null
  businessDate: string | null
  url: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function utcInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+Z$/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function businessDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null
}

function coordinate(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max ? value : null
}

function photo(value: unknown, houseId: number): HousePhoto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('The backend returned an invalid photo record.')
  }
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id <= 0 ||
      item.houseId !== houseId) {
    throw new ApiError('The backend returned an invalid photo record.')
  }
  return {
    id: item.id,
    stage: typeof item.stage === 'string' && constructionStages.includes(item.stage as ConstructionStage)
      ? item.stage as ConstructionStage : null,
    takenAt: utcInstant(item.takenAt),
    uploadedAt: utcInstant(item.uploadedAt),
    businessDate: businessDate(item.businessDate),
    url: text(item.url),
  }
}

export function parseHouseDetail(value: unknown, expectedId: number): HouseDetail {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('The backend returned an unexpected house detail format.')
  }
  const house = value as Record<string, unknown>
  if (house.id !== expectedId || !Array.isArray(house.photos)) {
    throw new ApiError('The backend returned an invalid house detail record.')
  }
  return {
    id: expectedId,
    permitNo: text(house.permitNo),
    address: text(house.address),
    community: text(house.community),
    lat: coordinate(house.lat, 90),
    lng: coordinate(house.lng, 180),
    stage: typeof house.stage === 'string' && constructionStages.includes(house.stage as ConstructionStage)
      ? house.stage as ConstructionStage : null,
    coverPhotoId: typeof house.coverPhotoId === 'number' && Number.isSafeInteger(house.coverPhotoId) &&
      house.coverPhotoId > 0 ? house.coverPhotoId : null,
    sourceType: house.sourceType === 'MANUAL' || house.sourceType === 'PUBLIC_DATA' ? house.sourceType : null,
    sourceUrl: text(house.sourceUrl),
    sourceFetchedAt: utcInstant(house.sourceFetchedAt),
    createdAt: utcInstant(house.createdAt),
    createdBusinessDate: businessDate(house.createdBusinessDate),
    createdBy: text(house.createdBy),
    updatedAt: utcInstant(house.updatedAt),
    photos: house.photos.map(item => photo(item, expectedId)),
  }
}

export async function getHouseDetail(id: number, signal?: AbortSignal): Promise<HouseDetail> {
  return parseHouseDetail(await getJson(`/api/houses/${id}`, signal), id)
}

export function displayUtcInstant(value: string | null): string {
  if (value === null) return 'Not available'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  }).format(new Date(value))
}

export function displayChicagoBusinessDate(value: string | null): string {
  if (value === null) return 'Not available'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}
