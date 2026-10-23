const METERS_PER_FOOT = 0.3048
const METERS_PER_MILE = 1609.344

export interface ScaleMark {
  label: string
  pixels: number
}

export interface SharedScale {
  width: number
  metric: ScaleMark
  imperial: ScaleMark
}

// Match Leaflet's round-number scale marks while keeping both units on the
// same map-distance-to-pixel ratio.
function roundDistance(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized >= 5 ? 5 : normalized >= 3 ? 3 : normalized >= 2 ? 2 : 1
  return step * magnitude
}

export function calculateSharedScale(maxMeters: number, maxPixels: number): SharedScale | null {
  if (!Number.isFinite(maxMeters) || maxMeters <= 0 || !Number.isFinite(maxPixels) || maxPixels <= 0) return null

  const metricMeters = roundDistance(maxMeters)
  const metric: ScaleMark = {
    label: metricMeters < 1000 ? `${metricMeters} m` : `${metricMeters / 1000} km`,
    pixels: maxPixels * metricMeters / maxMeters,
  }

  const maxFeet = maxMeters / METERS_PER_FOOT
  const useMiles = maxFeet > 5280
  const imperialDistance = roundDistance(useMiles ? maxMeters / METERS_PER_MILE : maxFeet)
  const imperial: ScaleMark = {
    label: `${imperialDistance} ${useMiles ? 'mi' : 'ft'}`,
    pixels: maxPixels * imperialDistance * (useMiles ? METERS_PER_MILE : METERS_PER_FOOT) / maxMeters,
  }

  return { width: Math.max(metric.pixels, imperial.pixels), metric, imperial }
}
