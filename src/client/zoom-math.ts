/**
 * Pure zoom/pan math for the diagram lightbox (transform-origin 0 0):
 * the rendered content sits at its natural size with its top-left corner at
 * (x, y) in stage coordinates, scaled by `scale`. Every helper is a pure
 * function of a {@link ZoomTransform}, so the interaction model is unit-
 * testable without a DOM.
 */

/** The transform of the lightbox content (top-left corner + uniform scale). */
export interface ZoomTransform {
  scale: number
  x: number
  y: number
}

/** Zoom range the lightbox allows (wheel, buttons, and fit all clamp into it). */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

/** The viewport margin the initial fit leaves around the content (8% of the stage). */
const FIT_MARGIN = 0.92

/** Clamp a scale into {@link MIN_ZOOM}–{@link MAX_ZOOM}. */
export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/**
 * The opening scale: fit the natural size into the stage with a margin, but
 * never upscale beyond 1:1 (the lightbox opens at original size unless the
 * diagram is too large for the viewport).
 */
export function fitZoom(width: number, height: number, stageWidth: number, stageHeight: number): number {
  return clampZoom(Math.min(1, (stageWidth / width) * FIT_MARGIN, (stageHeight / height) * FIT_MARGIN))
}

/** Center the content (natural `width` × `height`) in a stage at `scale`. */
export function centerTransform(
  width: number,
  height: number,
  stageWidth: number,
  stageHeight: number,
  scale: number,
): ZoomTransform {
  return {
    scale,
    x: (stageWidth - width * scale) / 2,
    y: (stageHeight - height * scale) / 2,
  }
}

/**
 * Zoom by `factor`, keeping the content point under the stage point
 * (px, py) stationary.
 */
export function zoomAt(t: ZoomTransform, px: number, py: number, factor: number): ZoomTransform {
  const scale = clampZoom(t.scale * factor)
  const ratio = scale / t.scale
  return {
    scale,
    x: px - (px - t.x) * ratio,
    y: py - (py - t.y) * ratio,
  }
}

/** Translate by a drag delta (pixels, stage coordinates). */
export function panBy(t: ZoomTransform, dx: number, dy: number): ZoomTransform {
  return { scale: t.scale, x: t.x + dx, y: t.y + dy }
}
