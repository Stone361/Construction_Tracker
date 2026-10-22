import type { DemoIdentity } from '../app/DemoIdentityContext'
import { ApiError, postJson } from './apiClient'
import { constructionStages } from './houses'
import type { ConstructionStage } from './houses'

export async function advanceHouse(houseId: number, fromStage: ConstructionStage, toStage: ConstructionStage,
  identity: DemoIdentity, onLateSettle?: () => void): Promise<void> {
  const index = constructionStages.indexOf(fromStage)
  if (!Number.isSafeInteger(houseId) || houseId <= 0 || constructionStages[index + 1] !== toStage) {
    throw new ApiError('Choose the next stage for a valid house.')
  }

  // A timeout ends the UI wait, not the submitted write. A late response triggers another read.
  let timedOut = false
  const request = postJson(`/api/houses/${houseId}/advance`, { fromStage, toStage }, undefined, identity)
  void request.then(() => { if (timedOut) onLateSettle?.() }, () => { if (timedOut) onLateSettle?.() })
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      reject(new ApiError('The stage advance result is unknown. Refresh house details before trying again.'))
    }, 20000)
  })
  let status: number
  try {
    ({ status } = await Promise.race([request, timeout]))
  } catch (error) {
    if (error instanceof ApiError && error.status !== undefined) throw error
    throw new ApiError('The stage advance result is unknown. Refresh house details before trying again.')
  } finally {
    clearTimeout(timeoutId)
  }
  if (status !== 200) throw new ApiError('The stage advance result is unknown. Refresh house details before trying again.')
}
