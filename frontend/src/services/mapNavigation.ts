import type { ConstructionStage } from './houses'

export interface MapView {
  center: [number, number]
  zoom: number
}

export interface MapSnapshot {
  view: MapView
  stage: ConstructionStage | null
  selectedHouseId: number | null
  community?: string | null
  addressSearch?: string
  mode?: 'summary' | 'explorer'
  summaryView?: MapView
  summarySelectedHouseId?: number | null
}

function validView(value: unknown): MapView | null {
  if (typeof value !== 'object' || value === null) return null
  const view = value as Record<string, unknown>
  const center = view.center
  const zoom = view.zoom
  if (!Array.isArray(center) || center.length !== 2 ||
      typeof center[0] !== 'number' || !Number.isFinite(center[0]) || Math.abs(center[0]) > 90 ||
      typeof center[1] !== 'number' || !Number.isFinite(center[1]) || Math.abs(center[1]) > 180 ||
      typeof zoom !== 'number' || !Number.isInteger(zoom) || zoom < 3 || zoom > 19) return null
  return { center: [center[0], center[1]], zoom }
}

export function mapSnapshotFromState(state: unknown): MapSnapshot | null {
  if (typeof state !== 'object' || state === null || !('mapSnapshot' in state)) return null
  const snapshot = state.mapSnapshot
  if (typeof snapshot !== 'object' || snapshot === null || !('view' in snapshot)) return null
  const view = validView(snapshot.view)
  if (!view) return null
  const saved = snapshot as Record<string, unknown>
  const allowedStages = ['LAND_CLEARING', 'FOUNDATION', 'FRAMING', 'MEP', 'INTERIOR', 'CO_READY']
  const stage = typeof saved.stage === 'string' && allowedStages.includes(saved.stage)
    ? saved.stage as ConstructionStage : null
  const selectedHouseId = typeof saved.selectedHouseId === 'number' &&
    Number.isSafeInteger(saved.selectedHouseId) && saved.selectedHouseId > 0 ? saved.selectedHouseId : null
  const community = typeof saved.community === 'string' && saved.community.trim()
    ? saved.community : null
  const addressSearch = typeof saved.addressSearch === 'string' && saved.addressSearch.length <= 200
    ? saved.addressSearch : ''
  const summaryView = validView(saved.summaryView) ?? view
  const summarySelectedHouseId = typeof saved.summarySelectedHouseId === 'number' &&
    Number.isSafeInteger(saved.summarySelectedHouseId) && saved.summarySelectedHouseId > 0
    ? saved.summarySelectedHouseId : null
  return { view, stage, selectedHouseId, community, addressSearch,
    mode: saved.mode === 'explorer' ? 'explorer' : 'summary', summaryView, summarySelectedHouseId }
}
