/**
 * MermaidLightbox component smoke: renders the overlay with the toolbar,
 * applies the opening fit transform, zooms via the native wheel listener,
 * pans via pointer events, and closes on Esc / backdrop / the close button.
 * jsdom has no layout, so geometry assertions stay on transform strings and
 * the pure math (zoom-math.spec.ts) — never on measured pixel values.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { MermaidLightbox } from '../src/client/MermaidLightbox.tsx'

const SVG = '<svg viewBox="0 0 800 600" width="100%"><rect /></svg>'

function mount(onClose: () => void = () => {}): { overlay: HTMLElement; stage: HTMLElement; content: HTMLElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(createElement(MermaidLightbox, { svg: SVG, width: 800, height: 600, title: '/p/a/diagram.md', onClose }))
  })
  const overlay = container.querySelector('[data-mermaid-lightbox]') as HTMLElement
  return {
    overlay,
    stage: overlay.querySelector('[class*="lightboxStage"]') as HTMLElement,
    content: overlay.querySelector('[class*="lightboxContent"]') as HTMLElement,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('MermaidLightbox', () => {
  it('renders the overlay, toolbar buttons, and the diagram svg', () => {
    const { overlay, unmount } = mount()
    try {
      expect(overlay).not.toBeNull()
      expect(overlay.querySelectorAll('button').length).toBeGreaterThanOrEqual(4)
      expect(overlay.querySelector('svg')).not.toBeNull()
      expect(overlay.textContent).toContain('/p/a/diagram.md')
    } finally {
      unmount()
    }
  })

  it('closes on the × button, the backdrop, and Esc', () => {
    const onClose = vi.fn()
    const { overlay, stage, unmount } = mount(onClose)
    try {
      const buttons = overlay.querySelectorAll('button')
      const closeButton = buttons[buttons.length - 1]! // the last button is ×
      act(() => { closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onClose).toHaveBeenCalledTimes(1)
      // Backdrop = the overlay itself (clicks inside it bubble but must not close).
      act(() => { overlay.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onClose).toHaveBeenCalledTimes(2)
      // A click on the stage content must NOT close.
      act(() => { stage.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onClose).toHaveBeenCalledTimes(2)
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
      expect(onClose).toHaveBeenCalledTimes(3)
    } finally {
      unmount()
    }
  })

  it('applies an opening transform to the content', () => {
    const { content, unmount } = mount()
    try {
      expect(content.style.transform).toMatch(/translate\([-\d.]+px, [-\d.]+px\) scale\([\d.]+\)/)
    } finally {
      unmount()
    }
  })

  it('zooms in on a wheel gesture and out again', () => {
    const { stage, content, unmount } = mount()
    try {
      const before = content.style.transform
      const event = new WheelEvent('wheel', { deltaY: -100, clientX: 10, clientY: 10, cancelable: true })
      act(() => { stage.dispatchEvent(event) })
      expect(event.defaultPrevented).toBe(true)
      expect(content.style.transform).not.toBe(before)
      const zoomedIn = content.style.transform
      act(() => { stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 10, clientY: 10 })) })
      expect(content.style.transform).not.toBe(zoomedIn)
    } finally {
      unmount()
    }
  })

  it('pans while dragging with pointer events', () => {
    const { stage, content, unmount } = mount()
    try {
      const before = content.style.transform
      const fire = (type: string, clientX: number, clientY: number): void => {
        act(() => { stage.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY })) })
      }
      fire('pointerdown', 100, 100)
      fire('pointermove', 140, 120)
      fire('pointerup', 140, 120)
      expect(content.style.transform).not.toBe(before)
      expect(content.style.transform).toContain('translate(')
    } finally {
      unmount()
    }
  })

  it('locks the body scroll while open and restores it on unmount', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = mount()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })
})
