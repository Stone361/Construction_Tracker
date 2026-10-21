import { useState } from 'react'
import { Route, Routes } from 'react-router'
import { AppShell } from '../app/AppShell'
import { HomePage } from '../pages/HomePage'
import { MapPage } from '../pages/MapPage'
import { HouseDetailPage } from '../pages/HouseDetailPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import type { MapSnapshot } from '../services/mapNavigation'

export function AppRoutes() {
  const [mapSnapshot, setMapSnapshot] = useState<MapSnapshot | null>(null)
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="map" element={<MapPage savedSnapshot={mapSnapshot} onSnapshotChange={setMapSnapshot} />} />
        <Route path="houses/:id" element={<HouseDetailPage savedSnapshot={mapSnapshot} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
