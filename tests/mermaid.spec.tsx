/**
 * Markdown-preview mermaid integration: the source-level fence parser and the
 * DOM pipeline that swaps ```mermaid fence code blocks for rendered diagrams
 * (or keeps the source plus an error note when rendering fails). Pure jsdom:
 * the helper operates on a hand-built DOM fixture shaped like MarkdownText's
 * CodeBlock output — no React, no CodeMirror, no mermaid library (the
 * renderer is a stub; the chunk itself is covered by the artifact gate).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { extractMermaidFences, hasMermaidFence, renderMermaidBlocks, type MermaidRenderer } from '../src/client/mermaid.ts'

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
})

describe('markdown preview mermaid integration', () => {
  it('replaces a rendered fence with a diagram host carrying the svg', async () => {
    const { host, block } = fenceFixture('mermaid', 'graph TD\nA --> B')
    const renderer: MermaidRenderer = async source => `<svg data-test="mermaid-svg">${source}</svg>`
    renderMermaidBlocks(host, ['graph TD\nA --> B'], renderer, false, 'boom', () => true)
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
    renderMermaidBlocks(host, ['graph TD\nA --> B'], renderer, false, '图表渲染失败', () => true)
    await flush()
    const diagram = host.querySelector('mermaid-diagram')
    expect(diagram).not.toBeNull()
    expect(diagram!.querySelector('div.md-code-block')).not.toBeNull()
    expect(block.isConnected).toBe(true)
    expect(diagram!.textContent).toContain('图表渲染失败')
  })

  it('keeps the source block and appends the error note when the chunk failed to load', () => {
    const { host, block } = fenceFixture('mermaid', 'graph TD\nA --> B')
    renderMermaidBlocks(host, ['graph TD\nA --> B'], undefined, false, 'Diagram rendering failed', () => true)
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
      return '<svg />'
    }
    renderMermaidBlocks(host, ['one', 'two'], renderer, true, 'boom', () => true)
    await flush()
    expect(seen).toEqual(['true:one', 'true:two'])
  })

  it('ignores code blocks whose infostring is not mermaid', async () => {
    const { host } = fenceFixture('ts', 'const a = 1')
    const renderer: MermaidRenderer = async () => { throw new Error('must not be called') }
    renderMermaidBlocks(host, ['const a = 1'], renderer, false, 'boom', () => true)
    await flush()
    expect(host.querySelector('mermaid-diagram')).toBeNull()
    expect(host.querySelector('div.md-code-block')).not.toBeNull()
  })

  it('never mutates a block after its mount deactivated (remount race)', async () => {
    const { host, block } = fenceFixture('mermaid', 'graph TD\nA --> B')
    let active = true
    let resolveRender: (svg: string) => void = () => {}
    const renderer: MermaidRenderer = () => new Promise(resolve => { resolveRender = resolve })
    renderMermaidBlocks(host, ['graph TD\nA --> B'], renderer, false, 'boom', () => active)
    active = false // the old mount disposed while the render was in flight
    resolveRender('<svg />')
    await flush()
    expect(host.querySelector('mermaid-diagram')).toBeNull()
    expect(block.isConnected).toBe(true)
  })
})
