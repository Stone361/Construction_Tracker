import type { DemoIdentity } from '../app/DemoIdentityContext'
import { ApiError, putJson } from './apiClient'
import { parseHouseDetail } from './houseDetail'
import type { HouseDetail } from './houseDetail'

export async function setHouseCover(houseId: number, photoId: number, identity: DemoIdentity): Promise<HouseDetail> {
  if (!Number.isSafeInteger(houseId) || houseId <= 0 || !Number.isSafeInteger(photoId) || photoId <= 0) {
    throw new ApiError('Choose a valid photo from this house.')
  }
  let response: { status: number; data: unknown }
  try {
    // A sent PUT may still complete on the server after navigation. Do not claim it was canceled.
    response = await putJson(`/api/houses/${houseId}/cover`, { photoId }, identity)
  } catch (error) {
    if (error instanceof ApiError && error.status !== undefined) throw error
    throw new ApiError('The cover update result is unknown. Refresh house details before trying again.')
  }
  if (response.status !== 200) throw new ApiError('The cover response was unexpected. Refresh house details.')
  try {
    const house = parseHouseDetail(response.data, houseId)
    if (house.coverPhotoId !== photoId) throw new Error('Cover ID mismatch')
    return house
  } catch {
    throw new ApiError('The cover may have changed, but the response was invalid. Refresh house details.')
  }
}
