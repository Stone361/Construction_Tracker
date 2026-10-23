import { useEffect, useState } from 'react'
import { useMap } from 'react-leaflet'
import { calculateSharedScale } from './sharedScale'
import type { SharedScale } from './sharedScale'
import styles from './ConstructionMap.module.css'

const MAX_WIDTH = 110

export function SharedScaleControl() {
  const map = useMap()
  const [scale, setScale] = useState<SharedScale | null>(null)

  useEffect(() => {
    const update = () => {
      const size = map.getSize()
      if (size.x <= 0 || size.y <= 0) {
        setScale(null)
        return
      }
      const width = Math.min(MAX_WIDTH, Math.max(1, size.x - 48))
      const y = size.y / 2
      const maxMeters = map.distance(
        map.containerPointToLatLng([0, y]),
        map.containerPointToLatLng([width, y]),
      )
      setScale(calculateSharedScale(maxMeters, width))
    }

    map.on('zoomend moveend resize', update)
    map.whenReady(update)
    return () => { map.off('zoomend moveend resize', update) }
  }, [map])

  if (!scale) return null

  return (
    <div className={styles.sharedScale} style={{ width: scale.width }} role="img" aria-label={`Map scale: ${scale.imperial.label} and ${scale.metric.label}`} data-testid="shared-map-scale">
      <span className={styles.scaleAxis} aria-hidden="true" data-testid="scale-axis" />
      <span className={styles.scaleOrigin} aria-hidden="true" />
      <span className={styles.scaleImperialTick} style={{ left: scale.imperial.pixels }} aria-hidden="true" data-testid="scale-imperial-tick" />
      <span className={styles.scaleMetricTick} style={{ left: scale.metric.pixels }} aria-hidden="true" data-testid="scale-metric-tick" />
      <span className={styles.scaleImperialLabel} style={{ left: scale.imperial.pixels }} aria-hidden="true">{scale.imperial.label}</span>
      <span className={styles.scaleMetricLabel} style={{ left: scale.metric.pixels }} aria-hidden="true">{scale.metric.label}</span>
    </div>
  )
}
