import { useState } from 'react'
import { Route, Routes } from 'react-router'
import { AppShell } from '../app/AppShell'
import { HomePage } from '../pages/HomePage'
import { MapPage } from '../pages/MapPage'
import { HouseDetailPage } from '../pages/HouseDetailPage'
import { CreateHousePage } from '../pages/CreateHousePage'
import { NotFoundPage } from '../pages/NotFoundPage'
import type { MapSnapshot } from '../services/mapNavigation'

export function AppRoutes() {
  const [mapSnapshot, setMapSnapshot] = useState<MapSnapshot | null>(null)
  const [coverRevision, setCoverRevision] = useState(0)
  const [stageRevision, setStageRevision] = useState(0)
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="map" element={<MapPage savedSnapshot={mapSnapshot} onSnapshotChange={setMapSnapshot}
          coverRevision={coverRevision} stageRevision={stageRevision} />} />
        <Route path="houses/new" element={<CreateHousePage />} />
        <Route path="houses/:id" element={<HouseDetailPage savedSnapshot={mapSnapshot}
          onCoverWriteSettled={() => setCoverRevision(current => current + 1)}
          onStageWriteSettled={() => setStageRevision(current => current + 1)} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
