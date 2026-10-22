import { constructionStages } from './houses'
import type { ConstructionStage } from './houses'
import type { HouseDetail } from './houseDetail'

export interface ConstructionProgressState {
  currentStage: ConstructionStage | null
  nextStage: ConstructionStage | null
  currentIndex: number
  currentStagePhotoCount: number
  eligiblePhotoCount: number
  photoRequirementMet: boolean
}

// Mirrors the read-only photo condition in PhotoMapper.hasEligiblePhoto.
// The backend checks the condition again when an advance is submitted.
export function constructionProgressFor(house: Pick<HouseDetail, 'stage' | 'photos'>): ConstructionProgressState {
  const currentIndex = house.stage === null ? -1 : constructionStages.indexOf(house.stage)
  const currentStage = currentIndex < 0 ? null : constructionStages[currentIndex] ?? null
  const nextStage = currentIndex < 0 ? null : constructionStages[currentIndex + 1] ?? null
  const currentStagePhotos = currentStage === null ? [] : house.photos.filter(photo => photo.stage === currentStage)
  const eligiblePhotoCount = currentStagePhotos.filter(photo =>
    photo.locationStatus === 'VERIFIED' || photo.locationStatus === 'UNKNOWN').length

  return {
    currentStage,
    nextStage,
    currentIndex,
    currentStagePhotoCount: currentStagePhotos.length,
    eligiblePhotoCount,
    photoRequirementMet: eligiblePhotoCount > 0,
  }
}
