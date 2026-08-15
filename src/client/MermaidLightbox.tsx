/**
 * The click-to-zoom lightbox for rendered mermaid diagrams: a full-screen
 * overlay (ported to document.body) showing the diagram at its original
 * size, fitted down when it exceeds the viewport. Interactions:
 * - drag anywhere on the stage to pan (pointer capture; touch-action none),
 * - mouse wheel to zoom around the cursor (native non-passive listener —
 *   React's synthetic wheel is passive and cannot preventDefault),
 * - + / − / fit buttons, a live zoom percentage, Esc / backdrop / close to
 *   leave, and a body scroll lock while open.
 *
 * The transform is applied imperatively through a ref: React never writes
 * the style, so zoom/pan state changes (label updates) never fight the DOM.
 * The svg markup itself is mermaid output sanitized by the library
 * (securityLevel 'strict'); it re-renders here through dangerouslySetInnerHTML
 * at the natural size passed by the caller.
 */
import { useEffect, useRef, useState } from 'react'
import { centerTransform, fitZoom, zoomAt, type ZoomTransform } from './zoom-math.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

interface MermaidLightboxProps {
  /** The sanitized diagram markup (mermaid render output). */
  svg: string
  /** The diagram's natural size in px (its viewBox), used for fit/zoom math. */
  width: number
  height: number
  /** The owning file path, shown in the toolbar. */
  title: string
  onClose: () => void
}

/** Wheel zoom speed: one notch ≈ 10%. */
const WHEEL_FACTOR = 1.1

/** Zoom step of the + / − buttons. */
const BUTTON_FACTOR = 1.25

export function MermaidLightbox({ svg, width, height, title, onClose }: MermaidLightboxProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const transformRef = useRef<ZoomTransform>({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; t: ZoomTransform } | null>(null)
  const [zoomPct, setZoomPct] = useState(100)

  const apply = (t: ZoomTransform): void => {
    transformRef.current = t
    const el = contentRef.current
    if (el !== null) el.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`
    setZoomPct(Math.round(t.scale * 100))
  }

  const stageSize = (): { width: number; height: number } => {
    const rect = stageRef.current?.getBoundingClientRect()
    return { width: Math.max(rect?.width ?? 800, 1), height: Math.max(rect?.height ?? 600, 1) }
  }

  const center = (scale: number): void => {
    const stage = stageSize()
    apply(centerTransform(width, height, stage.width, stage.height, scale))
  }

  // Body scroll lock + Esc to close.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Open fitted to the viewport; re-center (keeping the current scale) when
  // the window resizes.
  useEffect(() => {
    center(fitZoom(width, height, stageSize().width, stageSize().height))
    const onResize = (): void => { center(transformRef.current.scale) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- width/height only change per open (the overlay remounts per diagram)
  }, [width, height])

  // Native non-passive wheel listener: React's synthetic wheel event is
  // passive at the root and cannot preventDefault (page scroll would fight
  // the zoom).
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      const factor = Math.pow(WHEEL_FACTOR, -event.deltaY / 100)
      apply(zoomAt(transformRef.current, event.clientX - rect.left, event.clientY - rect.top, factor))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => { stage.removeEventListener('wheel', onWheel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply/transformRef are stable per mount
  }, [])

  const zoomAroundCenter = (factor: number): void => {
    const stage = stageSize()
    apply(zoomAt(transformRef.current, stage.width / 2, stage.height / 2, factor))
  }

  return (
    <div
      className={css.lightboxOverlay}
      data-mermaid-lightbox
      onClick={(event) => {
        // Backdrop clicks (the overlay itself, not the toolbar/stage) close.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={css.lightboxToolbar}>
        <span className={css.lightboxTitle}>{title}</span>
        <span className={css.lightboxZoomPct}>{zoomPct}%</span>
        <button type="button" className={css.lightboxButton} aria-label={t('zoomOut')} title={t('zoomOut')} onClick={() => { zoomAroundCenter(1 / BUTTON_FACTOR) }}>−</button>
        <button type="button" className={css.lightboxButton} aria-label={t('zoomIn')} title={t('zoomIn')} onClick={() => { zoomAroundCenter(BUTTON_FACTOR) }}>+</button>
        <button type="button" className={css.lightboxButton} aria-label={t('zoomFit')} title={t('zoomFit')} onClick={() => { center(fitZoom(width, height, stageSize().width, stageSize().height)) }}>{t('zoomFit')}</button>
        <button type="button" className={css.lightboxButton} aria-label={t('close')} title={t('close')} onClick={onClose}>×</button>
      </div>
      <div
        ref={stageRef}
        className={css.lightboxStage}
        onPointerDown={(event) => {
          dragRef.current = { startX: event.clientX, startY: event.clientY, t: transformRef.current }
          if (typeof event.pointerId === 'number') event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag === null) return
          apply({ scale: drag.t.scale, x: drag.t.x + event.clientX - drag.startX, y: drag.t.y + event.clientY - drag.startY })
        }}
        onPointerUp={() => { dragRef.current = null }}
        onPointerCancel={() => { dragRef.current = null }}
      >
        <div
          ref={contentRef}
          className={css.lightboxContent}
          style={{ width, height }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  )
}
