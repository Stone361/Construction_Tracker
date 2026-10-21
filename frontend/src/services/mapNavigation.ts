import type { ConstructionStage } from './houses'

export interface MapView {
  center: [number, number]
  zoom: number
}

export interface MapSnapshot {
  view: MapView
  stage: ConstructionStage | null
  selectedHouseId: number | null
}

export function mapSnapshotFromState(state: unknown): MapSnapshot | null {
  if (typeof state !== 'object' || state === null || !('mapSnapshot' in state)) return null
  const snapshot = state.mapSnapshot
  if (typeof snapshot !== 'object' || snapshot === null || !('view' in snapshot) ||
      typeof snapshot.view !== 'object' || snapshot.view === null) return null
  const view = snapshot.view as Record<string, unknown>
  const center = view.center
  const zoom = view.zoom
  if (!Array.isArray(center) || center.length !== 2 ||
      typeof center[0] !== 'number' || !Number.isFinite(center[0]) || Math.abs(center[0]) > 90 ||
      typeof center[1] !== 'number' || !Number.isFinite(center[1]) || Math.abs(center[1]) > 180 ||
      typeof zoom !== 'number' || !Number.isInteger(zoom) || zoom < 3 || zoom > 19) return null
  const saved = snapshot as Record<string, unknown>
  const allowedStages = ['LAND_CLEARING', 'FOUNDATION', 'FRAMING', 'MEP', 'INTERIOR', 'CO_READY']
  const stage = typeof saved.stage === 'string' && allowedStages.includes(saved.stage)
    ? saved.stage as ConstructionStage : null
  const selectedHouseId = typeof saved.selectedHouseId === 'number' &&
    Number.isSafeInteger(saved.selectedHouseId) && saved.selectedHouseId > 0 ? saved.selectedHouseId : null
  return { view: { center: [center[0], center[1]], zoom }, stage, selectedHouseId }
}
