import { describe, expect, it } from 'vitest'
import { calculateSharedScale } from './sharedScale'

describe('shared map scale', () => {
  it('places metric and imperial ticks using the same meters-per-pixel value', () => {
    const scale = calculateSharedScale(3000, 110)
    expect(scale).not.toBeNull()
    expect(scale?.metric.label).toBe('3 km')
    expect(scale?.imperial.label).toBe('1 mi')
    expect(scale?.metric.pixels).toBeCloseTo(110)
    expect(scale?.imperial.pixels).toBeCloseTo(110 * 1609.344 / 3000)
    expect(scale?.imperial.pixels).not.toBe(scale?.metric.pixels)
    expect(scale?.width).toBeCloseTo(110)
  })

  it('uses meters and feet at closer zoom levels', () => {
    const scale = calculateSharedScale(200, 110)
    expect(scale?.metric.label).toBe('200 m')
    expect(scale?.imperial.label).toBe('500 ft')
    expect(scale?.imperial.pixels).toBeCloseTo(110 * (500 * 0.3048) / 200)
  })

  it('rejects measurements that cannot produce a real scale', () => {
    expect(calculateSharedScale(0, 110)).toBeNull()
    expect(calculateSharedScale(Number.NaN, 110)).toBeNull()
    expect(calculateSharedScale(100, 0)).toBeNull()
  })
})
