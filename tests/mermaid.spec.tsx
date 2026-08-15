/**
 * Markdown-preview mermaid integration: the source-level fence parser and the
 * DOM pipeline that swaps ```mermaid fence code blocks for rendered diagrams
 * (or keeps the source plus an error note when rendering fails), applies the
 * preview size cap, and wires the click-to-zoom callback. Pure jsdom: the
 * helper operates on a hand-built DOM fixture shaped like MarkdownText's
 * CodeBlock output — no React, no CodeMirror, no mermaid library (the
 * renderer is a stub; the chunk itself is covered by the artifact gate).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractMermaidFences,
  hasMermaidFence,
  MERMAID_PREVIEW_MAX_HEIGHT,
  MERMAID_PREVIEW_MAX_WIDTH,
  parseViewBox,
  renderMermaidBlocks,
  type MermaidRenderOptions,
  type MermaidRenderer,
} from '../src/client/mermaid.ts'

/**
 * Build one preview container holding one code block in MarkdownText's DOM
 * shape: `.md-code-block` > (bannerWrap > banner > infostring) + pre > code.
 */
function fenceFixture(infostring: string, body: string): { host: HTMLElement; block: HTMLElement } {
  const host = document.createElement('div')
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const bannerWrap = document.createElement('div')
  const banner = document.createElement('div')
  const info = document.createElement('div')
  info.textContent = infostring
  banner.append(info)
  bannerWrap.append(banner)
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = body
  pre.append(code)
  block.append(bannerWrap, pre)
  host.append(block)
  document.body.append(host)
  return { host, block }
}

/** Default pipeline options with one overridable renderer + open callback. */
function options(overrides: Partial<MermaidRenderOptions> = {}): MermaidRenderOptions {
  return {
    renderer: async () => '<svg viewBox="0 0 100 80" width="100%"><rect /></svg>',
    dark: false,
    errorLabel: 'Diagram rendering failed',
    zoomHint: 'Click to enlarge',
    isActive: () => true,
    ...overrides,
  }
}

/** Flush microtasks + a macrotask so the async render continuations run. */
const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

afterEach(() => {
  document.body.innerHTML = ''
})

describe('mermaid fence parsing', () => {
  it('extracts the bodies of mermaid fences in document order', () => {
    const text = [
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  A->>B: hi',
      '```',
    ].join('\n')
    expect(extractMermaidFences(text)).toEqual(['graph TD\n  A --> B', 'sequenceDiagram\n  A->>B: hi'])
  })

  it('accepts 4-backtick fences, leading space, and an info-string suffix', () => {
    expect(extractMermaidFences('````mermaid\ngraph TD\n````')).toEqual(['graph TD'])
    expect(extractMermaidFences('``` mermaid\ngraph TD\n```')).toEqual(['graph TD'])
    expect(extractMermaidFences('```mermaid flowchart\ngraph TD\n```')).toEqual(['graph TD'])
  })

  it('ignores other fences and returns an empty list without one', () => {
    expect(extractMermaidFences('```ts\nconst a = 1\n```')).toEqual([])
    expect(extractMermaidFences('no fences here')).toEqual([])
  })

  it('hasMermaidFence gates on fence presence only', () => {
    expect(hasMermaidFence('```mermaid\ngraph TD\n```')).toBe(true)
    expect(hasMermaidFence('```ts\nconst a = 1\n```')).toBe(false)
    expect(hasMermaidFence('see ```mermaid inline')).toBe(false)
  })

  it('parseViewBox reads the natural size and rejects malformed values', () => {
    expect(parseViewBox('0 0 200 100')).toEqual({ width: 200, height: 100 })
    expect(parseViewBox('10, 20, 300.5, 150.25')).toEqual({ width: 300.5, height: 150.25 })
    expect(parseViewBox(null)).toBeUndefined()
    expect(parseViewBox('0 0')).toBeUndefined()
    expect(parseViewBox('0 0 -1 10')).toBeUndefined()
    expect(parseViewBox('a b c d')).toBeUndefined()
  })
})

describe('markdown preview mermaid integration', () => {
  it('replaces a rendered fence with a diagram host carrying the svg', async () => {
    const { host, block } = fenceFixture('mermaid', 'graph TD\nA --> B')
    const renderer: MermaidRenderer = async source => `<svg viewBox="0 0 100 80" data-test="mermaid-svg">${source}</svg>`
    renderMermaidBlocks(host, ['graph TD\nA --> B'], options({ renderer }))
    await flush()
    const diagram = host.querySelector('mermaid-diagram')
    expect(diagram).not.toBeNull()
    expect(diagram!.querySelector('svg')).not.toBeNull()
    expect(host.querySelector('div.md-code-block')).toBeNull()
    expect(block.isConnected).toBe(false)
  })

  it('keeps the source block and appends the error note when rendering rejects', async () => {
    const { host, block } = fenceFixture('mermaid', 'graph TD\nA --> B')
    const renderer: MermaidRenderer = async () => { throw new Error('parse error') }
    renderMermaidBlocks(host, ['graph TD\nA --> B'], options({ renderer, errorLabel: '图表渲染失败' }))
    await flush()
    const diagram = host.querySelector('mermaid-diagram')
    expect(diagram).not.toBeNull()
    expect(diagram!.querySelector('div.md-code-block')).not.toBeNull()
    expect(block.isConnected).toBe(true)
    expect(diagram!.textContent).toContain('图表渲染失败')
  })

  it('keeps the source block and appends the error note when the chunk failed to load', () => {
    const { host, block } = fenceFixture('mermaid', 'graph TD\nA --> B')
    renderMermaidBlocks(host, ['graph TD\nA --> B'], options({ renderer: undefined }))
    const diagram = host.querySelector('mermaid-diagram')
    expect(diagram).not.toBeNull()
    expect(block.isConnected).toBe(true)
    expect(diagram!.textContent).toContain('Diagram rendering failed')
  })

  it('passes each fence body and the resolved scheme to the renderer, in order', async () => {
    const { host } = fenceFixture('mermaid', 'one')
    const second = document.createElement('div')
    second.className = 'md-code-block'
    const bannerWrap = document.createElement('div')
    const banner = document.createElement('div')
    const info = document.createElement('div')
    info.textContent = 'mermaid'
    banner.append(info)
    bannerWrap.append(banner)
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = 'two'
    pre.append(code)
    second.append(bannerWrap, pre)
    host.append(second)
    const seen: string[] = []
    const renderer: MermaidRenderer = async (source, dark) => {
      seen.push(`${dark}:${source}`)
      return '<svg viewBox="0 0 100 80" />'
    }
    renderMermaidBlocks(host, ['one', 'two'], options({ renderer, dark: true }))
    await flush()
    expect(seen).toEqual(['true:one', 'true:two'])
  })

  it('ignores code blocks whose infostring is not mermaid', async () => {
    const { host } = fenceFixture('ts', 'const a = 1')
    const renderer: MermaidRenderer = async () => { throw new Error('must not be called') }
    renderMermaidBlocks(host, ['const a = 1'], options({ renderer }))
    await flush()
    expect(host.querySelector('mermaid-diagram')).toBeNull()
    expect(host.querySelector('div.md-code-block')).not.toBeNull()
  })

  it('never mutates a block after its mount deactivated (remount race)', async () => {
    const { host, block } = fenceFixture('mermaid', 'graph TD\nA --> B')
    let active = true
    let resolveRender: (svg: string) => void = () => {}
    const renderer: MermaidRenderer = () => new Promise(resolve => { resolveRender = resolve })
    renderMermaidBlocks(host, ['graph TD\nA --> B'], options({ renderer, isActive: () => active }))
    active = false // the old mount disposed while the render was in flight
    resolveRender('<svg viewBox="0 0 100 80" />')
    await flush()
    expect(host.querySelector('mermaid-diagram')).toBeNull()
    expect(block.isConnected).toBe(true)
  })
})

describe('preview size cap and click-to-zoom wiring', () => {
  it('scales an oversized diagram down to the preview caps (ratio-safe, width-bound)', async () => {
    const { host } = fenceFixture('mermaid', 'x')
    const renderer: MermaidRenderer = async () => '<svg viewBox="0 0 2000 1000" width="100%" />'
    renderMermaidBlocks(host, ['x'], options({ renderer }))
    await flush()
    const svg = host.querySelector('mermaid-diagram svg') as SVGSVGElement
    expect(svg).not.toBeNull()
    // min(720/2000, 480/1000) = 0.36 → capped width 720 (the height cap also
    // binds exactly; width is the value the cap writes).
    expect(svg.style.width).toBe(`${MERMAID_PREVIEW_MAX_WIDTH}px`)
    expect(svg.style.height).toBe('auto')
    expect(svg.style.maxWidth).toBe('100%')
  })

  it('scales a tall-but-narrow diagram down by the height cap', async () => {
    const { host } = fenceFixture('mermaid', 'x')
    const renderer: MermaidRenderer = async () => '<svg viewBox="0 0 300 1200" width="100%" />'
    renderMermaidBlocks(host, ['x'], options({ renderer }))
    await flush()
    const svg = host.querySelector('mermaid-diagram svg') as SVGSVGElement
    expect(svg.style.width).toBe(`${Math.round(300 * (MERMAID_PREVIEW_MAX_HEIGHT / 1200))}px`)
    expect(svg.style.height).toBe('auto')
  })

  it('leaves a small diagram at its natural size', async () => {
    const { host } = fenceFixture('mermaid', 'x')
    renderMermaidBlocks(host, ['x'], options())
    await flush()
    const svg = host.querySelector('mermaid-diagram svg') as SVGSVGElement
    expect(svg.style.width).toBe('')
    expect(svg.style.height).toBe('')
  })

  it('opens the original (uncapped) markup and natural size on click', async () => {
    const { host } = fenceFixture('mermaid', 'x')
    const renderer: MermaidRenderer = async () => '<svg viewBox="0 0 2000 1000" data-test="big" />'
    const opened: unknown[] = []
    renderMermaidBlocks(host, ['x'], options({ renderer, open: (diagram) => { opened.push(diagram) } }))
    await flush()
    const diagram = host.querySelector('mermaid-diagram') as HTMLElement
    expect(diagram.getAttribute('role')).toBe('button')
    expect(diagram.getAttribute('tabindex')).toBe('0')
    expect(diagram.getAttribute('title')).toBe('Click to enlarge')
    diagram.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(opened).toEqual([{ svg: '<svg viewBox="0 0 2000 1000" data-test="big" />', width: 2000, height: 1000 }])
  })

  it('opens on Enter/Space keyboard activation', async () => {
    const { host } = fenceFixture('mermaid', 'x')
    let opened = 0
    renderMermaidBlocks(host, ['x'], options({ open: () => { opened++ } }))
    await flush()
    const diagram = host.querySelector('mermaid-diagram') as HTMLElement
    diagram.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    diagram.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(opened).toBe(2)
  })

  it('stays non-interactive without an open handler', async () => {
    const { host } = fenceFixture('mermaid', 'x')
    renderMermaidBlocks(host, ['x'], options())
    await flush()
    const diagram = host.querySelector('mermaid-diagram') as HTMLElement
    expect(diagram.hasAttribute('role')).toBe(false)
    expect(diagram.hasAttribute('tabindex')).toBe(false)
  })
})
