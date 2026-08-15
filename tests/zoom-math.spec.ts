/**
 * Pure zoom/pan math for the diagram lightbox: fit, centering, cursor-
 * anchored zoom, clamping, and pan deltas.
 */
import { describe, expect, it } from 'vitest'
import {
  centerTransform, clampZoom, fitZoom, MAX_ZOOM, MIN_ZOOM, panBy, zoomAt,
} from '../src/client/zoom-math.ts'

describe('lightbox zoom math', () => {
  it('clampZoom bounds the scale into the allowed range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(100)).toBe(MAX_ZOOM)
    expect(clampZoom(-3)).toBe(MIN_ZOOM)
  })

  it('fitZoom contains the diagram with a margin and never upscales past 1', () => {
    // Both dimensions overflow → the tighter axis wins (height here).
    expect(fitZoom(2000, 1000, 1000, 400)).toBeCloseTo((400 / 1000) * 0.92)
    expect(fitZoom(1000, 2000, 1000, 400)).toBeCloseTo((400 / 2000) * 0.92)
    // Small diagram → opens at 1:1 (never upscaled).
    expect(fitZoom(200, 100, 1000, 800)).toBe(1)
    // Degenerate zero-sized stage still yields a sane clamp.
    expect(fitZoom(500, 500, 0, 0)).toBe(MIN_ZOOM)
  })

  it('centerTransform puts the scaled content in the middle of the stage', () => {
    expect(centerTransform(200, 100, 1000, 800, 2)).toEqual({ scale: 2, x: 300, y: 300 })
    expect(centerTransform(200, 100, 1000, 800, 0.5)).toEqual({ scale: 0.5, x: 450, y: 375 })
  })

  it('zoomAt keeps the content point under the cursor stationary', () => {
    const t = { scale: 1, x: 100, y: 50 }
    const zoomed = zoomAt(t, 300, 200, 2)
    // The content point under the cursor is (200, 150) in content coords; at
    // double the scale its screen position must stay at the cursor (300, 200).
    expect(zoomed.scale).toBe(2)
    expect(zoomed.x).toBe(-100)
    expect(zoomed.y).toBe(-100)
  })

  it('zoomAt clamps at the bounds (the anchor then shifts with the clamp)', () => {
    const min = zoomAt({ scale: 0.2, x: 0, y: 0 }, 100, 100, 0.0001)
    expect(min.scale).toBe(MIN_ZOOM)
    const max = zoomAt({ scale: 4, x: 0, y: 0 }, 100, 100, 1000)
    expect(max.scale).toBe(MAX_ZOOM)
  })

  it('panBy translates without touching the scale', () => {
    expect(panBy({ scale: 1.5, x: 10, y: 20 }, -5, 7)).toEqual({ scale: 1.5, x: 5, y: 27 })
  })
})
