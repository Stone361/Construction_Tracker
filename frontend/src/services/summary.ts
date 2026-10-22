import type { DemoIdentity } from '../app/DemoIdentityContext'
import { ApiError, getJson } from './apiClient'
import { constructionStages } from './houses'
import type { ConstructionStage } from './houses'

export interface CurrentSummary {
  stageCounts: Record<ConstructionStage, number>
  staleHouseIds: number[]
  totalHouses: number
}

export function parseSummary(data: unknown): CurrentSummary {
  if (typeof data !== 'object' || data === null || !('stageCounts' in data) ||
      typeof data.stageCounts !== 'object' || data.stageCounts === null ||
      !('staleHouseIds' in data) || !Array.isArray(data.staleHouseIds)) {
    throw new ApiError('The backend returned an unexpected summary format.')
  }
  const source = data.stageCounts as Record<string, unknown>
  const stageCounts = {} as Record<ConstructionStage, number>
  for (const stage of constructionStages) {
    const count = source[stage]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new ApiError('The backend returned invalid stage counts.')
    }
    stageCounts[stage] = count
  }
  const staleHouseIds = data.staleHouseIds as unknown[]
  if (!staleHouseIds.every(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
      new Set(staleHouseIds).size !== staleHouseIds.length) {
    throw new ApiError('The backend returned invalid attention house IDs.')
  }
  return {
    stageCounts,
    staleHouseIds: staleHouseIds as number[],
    totalHouses: constructionStages.reduce((total, stage) => total + stageCounts[stage], 0),
  }
}

export async function getCurrentSummary(signal: AbortSignal, identity: DemoIdentity): Promise<CurrentSummary> {
  return parseSummary(await getJson('/api/summary', signal, identity))
}
