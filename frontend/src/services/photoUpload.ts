import type { DemoIdentity } from '../app/DemoIdentityContext'
import { ApiError, postMultipart } from './apiClient'

export const maximumPhotoBytes = 10_000_000
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
export type GpsStatus = 'VERIFIED' | 'UNKNOWN' | 'SUSPECT'

export function validatePhotoFile(file: File): string | null {
  if (!imageTypes.has(file.type)) return 'Choose a JPEG, PNG, or WebP image.'
  if (file.size === 0) return 'Choose a non-empty image.'
  if (file.size > maximumPhotoBytes) return 'The photo must be no larger than 10,000,000 bytes.'
  return null
}

export async function uploadHousePhoto(houseId: number, file: File, identity: DemoIdentity): Promise<{
  status: 200 | 201; photoId: number; gpsStatus: GpsStatus
}> {
  const validation = validatePhotoFile(file)
  if (validation) throw new ApiError(validation)
  if (!Number.isSafeInteger(houseId) || houseId <= 0) throw new ApiError('The house ID is invalid.')
  const form = new FormData()
  form.append('file', file)
  const { status, data } = await postMultipart(`/api/houses/${houseId}/photos`, form, identity)
  if ((status !== 200 && status !== 201) || typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ApiError('The upload may have succeeded, but the response was invalid. Refresh details before trying again.')
  }
  const photo = data as Record<string, unknown>
  if (photo.houseId !== houseId || typeof photo.id !== 'number' || !Number.isSafeInteger(photo.id) || photo.id <= 0 ||
      (photo.locationStatus !== 'VERIFIED' && photo.locationStatus !== 'UNKNOWN' && photo.locationStatus !== 'SUSPECT')) {
    throw new ApiError('The upload may have succeeded, but the response was invalid. Refresh details before trying again.')
  }
  return { status, photoId: photo.id, gpsStatus: photo.locationStatus }
}
