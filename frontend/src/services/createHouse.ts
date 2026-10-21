import type { DemoIdentity } from '../app/DemoIdentityContext'
import { ApiError, postJson } from './apiClient'

export interface HouseFormValues {
  permitNo: string
  address: string
  community: string
  lat: string
  lng: string
  sourceUrl: string
  sourceFetchedAt: string
}

export const emptyHouseForm: HouseFormValues = {
  permitNo: '', address: '', community: '', lat: '', lng: '', sourceUrl: '', sourceFetchedAt: '',
}

export type HouseFormField = keyof HouseFormValues
export type HouseFormErrors = Partial<Record<HouseFormField, string>>

export interface CreateHousePayload {
  permitNo: string
  address: string
  community: string
  lat: number | null
  lng: number | null
  sourceUrl: string | null
  sourceFetchedAt: string | null
}

function coordinate(value: string, limit: number): number | null {
  if (!/^-?\d{1,3}(?:\.\d{1,7})?$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null
}

export function validateHouseForm(values: HouseFormValues):
  { errors: HouseFormErrors; payload: CreateHousePayload | null } {
  const errors: HouseFormErrors = {}
  const permitNo = values.permitNo.trim()
  const address = values.address.trim()
  const community = values.community.trim()
  const latText = values.lat.trim()
  const lngText = values.lng.trim()
  const sourceUrl = values.sourceUrl.trim()
  const sourceFetchedAt = values.sourceFetchedAt.trim()

  if (!permitNo) errors.permitNo = 'Permit number is required.'
  else if (permitNo.length > 128) errors.permitNo = 'Use 128 characters or fewer.'
  if (!address) errors.address = 'Address is required.'
  else if (address.length > 512) errors.address = 'Use 512 characters or fewer.'
  if (!community) errors.community = 'Community is required.'
  else if (community.length > 128) errors.community = 'Use 128 characters or fewer.'

  let lat: number | null = null
  let lng: number | null = null
  if (latText || lngText) {
    if (!latText) errors.lat = 'Enter latitude and longitude together.'
    else {
      lat = coordinate(latText, 90)
      if (lat === null) errors.lat = 'Enter a number from -90 to 90 with at most 7 decimal places.'
    }
    if (!lngText) errors.lng = 'Enter latitude and longitude together.'
    else {
      lng = coordinate(lngText, 180)
      if (lng === null) errors.lng = 'Enter a number from -180 to 180 with at most 7 decimal places.'
    }
  }

  let fetchedUtc: string | null = null
  if (sourceUrl || sourceFetchedAt) {
    if (!sourceUrl) errors.sourceUrl = 'Provide the source URL and fetched time together.'
    else if (sourceUrl.length > 2048) errors.sourceUrl = 'Use 2048 characters or fewer.'
    else {
      try {
        const url = new URL(sourceUrl)
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
          errors.sourceUrl = 'Use an HTTP or HTTPS URL without sign-in details.'
        }
      } catch {
        errors.sourceUrl = 'Enter a valid HTTP or HTTPS URL.'
      }
    }
    if (!sourceFetchedAt) errors.sourceFetchedAt = 'Provide the source URL and fetched time together.'
    else {
      const parsed = new Date(sourceFetchedAt)
      if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 1000 || parsed.getUTCFullYear() > 9999) {
        errors.sourceFetchedAt = 'Enter a valid local date and time.'
      } else fetchedUtc = parsed.toISOString()
    }
  }

  return {
    errors,
    payload: Object.keys(errors).length ? null : {
      permitNo, address, community, lat, lng,
      sourceUrl: sourceUrl || null, sourceFetchedAt: fetchedUtc,
    },
  }
}

export interface CreateHouseResult {
  id: number
  kind: 'created' | 'existing'
}

export async function createHouse(payload: CreateHousePayload, signal: AbortSignal,
  identity: DemoIdentity): Promise<CreateHouseResult> {
  const { status, data } = await postJson('/api/houses', payload, signal, identity)
  if ((status !== 200 && status !== 201) || typeof data !== 'object' || data === null || Array.isArray(data) ||
      !('id' in data) || typeof data.id !== 'number' ||
      !Number.isSafeInteger(data.id) || data.id <= 0) {
    throw new ApiError('The backend returned an invalid house creation response.')
  }
  return { id: data.id, kind: status === 201 ? 'created' : 'existing' }
}
