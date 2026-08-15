/**
 * Markdown-preview mermaid integration (the DOM layer). TextEditor's preview
 * renders the whole document through DSH's MarkdownText, which has no
 * mermaid support: a ```mermaid fence comes back as an ordinary code block —
 * a `.md-code-block` wrapper whose banner infostring names the language and
 * whose body holds the source (the non-empty fence path carries NO
 * `language-*` class in the DOM, so the infostring is the only marker). This
 * module pairs the mermaid fence bodies parsed from the source text with the
 * rendered blocks (in document order) and swaps each for the diagram SVG, or
 * keeps the block and appends an error note when rendering fails.
 *
 * Preview size cap: a diagram whose viewBox exceeds
 * {@link MERMAID_PREVIEW_MAX_WIDTH} × {@link MERMAID_PREVIEW_MAX_HEIGHT} is
 * scaled down uniformly (inline width + `height: auto` + `max-width: 100%`,
 * so narrow panes still shrink it further without distortion). Every diagram
 * is click-to-zoom: the wrapper carries role/tabindex/keyboard handling and
 * calls `open` with the original (uncapped) markup and natural size for the
 * lightbox.
 *
 * The swap runs once per preview mount: TextEditor keys its preview container
 * by (scheme, text), so a text or theme change remounts the subtree and this
 * pipeline re-runs on pristine React-rendered DOM. Injected wrappers are
 * therefore never reconciled by React (its fiber tree never knows them), and
 * every async continuation checks `isActive()` plus the node's connection
 * state before mutating — a stale render can never touch live DOM.
 */
import css from './sidebar.module.css'

/** A fence opening line whose info string is `mermaid` (3+ backticks, optional leading space). */
const MERMAID_FENCE_RE = /^`{3,}\s*mermaid(?:\s|$)/m

/** One mermaid fence with its body: opening line, body, closing fence line (3+ backticks). */
const MERMAID_FENCE_BODY_RE = /^`{3,}\s*mermaid(?:[^\S\n][^\n]*)?\n([\s\S]*?)^`{3,}[^\S\n]*$/gm

/** The fenced-code wrapper MarkdownText emits (literal class, not hashed). */
const CODE_BLOCK_SELECTOR = 'div.md-code-block'

/** The diagram/error host element; a custom tag so it can never type-match React-rendered markup. */
const DIAGRAM_TAG = 'mermaid-diagram'

/** Hashed class names for manually created hosts (the css-module map is typed with unchecked indexes). */
const mdMermaidClass = css.mdMermaid ?? ''
const mdMermaidErrorClass = css.mdMermaidError ?? ''

/** Preview size caps: diagrams beyond this box scale down; click opens the original. */
export const MERMAID_PREVIEW_MAX_WIDTH = 720
export const MERMAID_PREVIEW_MAX_HEIGHT = 480

/** The mermaid chunk's render function (src/client/chunks/mermaid.tsx). */
export type MermaidRenderer = (source: string, dark: boolean) => Promise<string>

/** One rendered diagram's data, handed to the lightbox on click. */
export interface MermaidDiagramData {
  svg: string
  width: number
  height: number
}

/** Click-to-zoom callback (the caller composes the title from its own context). */
export type MermaidOpenHandler = (diagram: MermaidDiagramData) => void

/** Everything the block swap needs besides the host and the fence bodies. */
export interface MermaidRenderOptions {
  renderer: MermaidRenderer | undefined
  dark: boolean
  errorLabel: string
  /** Hover/aria hint on clickable diagrams (localized). */
  zoomHint: string
  isActive: () => boolean
  open?: MermaidOpenHandler | undefined
}

/**
 * The bodies of every ```mermaid fence in a markdown source, in document
 * order. Doubles as the cheap "any fence at all" gate.
 * @param text - The markdown source.
 */
export function extractMermaidFences(text: string): string[] {
  const bodies: string[] = []
  for (const match of text.matchAll(MERMAID_FENCE_BODY_RE)) {
    // The capture includes the line break that separates the body from the
    // closing fence; strip exactly that one (diagram sources never need it).
    bodies.push(match[1]!.replace(/\n$/, ''))
  }
  return bodies
}

/** Whether a markdown source contains at least one mermaid fence. */
export function hasMermaidFence(text: string): boolean {
  return MERMAID_FENCE_RE.test(text)
}

/**
 * A rendered code block's fence language, read from its banner infostring
 * (`bannerWrap > banner > infostring` — the only place the fence's language
 * lands for a non-empty fence in the current MarkdownText DOM).
 */
function infostringOf(block: HTMLElement): string {
  return block.firstElementChild?.firstElementChild?.firstElementChild?.textContent?.trim() ?? ''
}

/**
 * The natural size of a rendered diagram from its viewBox attribute
 * (`"min-x min-y width height"`, numbers may be space/comma separated).
 * Mermaid always emits one; undefined means the cap and the click-to-zoom
 * sizing are skipped.
 */
export function parseViewBox(viewBox: string | null): { width: number; height: number } | undefined {
  if (viewBox === null) return undefined
  const parts = viewBox.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) return undefined
  const [, , width, height] = parts
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined
  return { width, height }
}

/** Scale a rendered diagram down to the preview caps (uniform, ratio-safe). */
function applyPreviewCap(svg: SVGSVGElement, size: { width: number; height: number }): void {
  if (size.width <= MERMAID_PREVIEW_MAX_WIDTH && size.height <= MERMAID_PREVIEW_MAX_HEIGHT) return
  const scale = Math.min(MERMAID_PREVIEW_MAX_WIDTH / size.width, MERMAID_PREVIEW_MAX_HEIGHT / size.height)
  const style = svg.style
  style.width = `${Math.round(size.width * scale)}px`
  // height auto + the viewBox ratio keep the shrink uniform; max-width lets a
  // pane narrower than the cap shrink it further without distortion.
  style.height = 'auto'
  style.maxWidth = '100%'
}

/**
 * Swap every ```mermaid fence code block under `host` for its rendered
 * diagram. `renderer` of undefined means the lazy mermaid chunk failed to
 * load — each block then keeps its source and gains the error note instead.
 * @param host - The preview container (TextEditor's `mdRef` current node).
 * @param sources - The fence bodies from {@link extractMermaidFences}, in order.
 * @param options - Renderer, scheme, labels, liveness probe, and the optional
 *   click-to-zoom callback.
 */
export function renderMermaidBlocks(
  host: HTMLElement,
  sources: readonly string[],
  options: MermaidRenderOptions,
): void {
  const { renderer, dark, errorLabel, zoomHint, isActive, open } = options
  const blocks = Array.from(host.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR))
    .filter(block => infostringOf(block) === 'mermaid')
  for (const [index, block] of blocks.entries()) {
    const source = sources[index]
    if (source === undefined) continue
    if (!block.isConnected) continue
    if (renderer === undefined) {
      wrapWithError(block, errorLabel)
      continue
    }
    void renderer(source, dark).then((svg) => {
      if (!isActive() || !block.isConnected) return
      const diagram = document.createElement(DIAGRAM_TAG)
      diagram.className = mdMermaidClass
      // Mermaid output is sanitized by the library (securityLevel 'strict');
      // the SVG is static markup, so innerHTML on a fresh element is safe.
      diagram.innerHTML = svg
      const svgEl = diagram.querySelector('svg')
      const size = svgEl === null ? undefined : parseViewBox(svgEl.getAttribute('viewBox'))
      if (svgEl !== null && size !== undefined) applyPreviewCap(svgEl as SVGSVGElement, size)
      if (size !== undefined && open !== undefined) {
        diagram.setAttribute('role', 'button')
        diagram.setAttribute('tabindex', '0')
        diagram.setAttribute('aria-label', zoomHint)
        diagram.setAttribute('title', zoomHint)
        const openOriginal = (): void => { open({ svg, width: size.width, height: size.height }) }
        diagram.addEventListener('click', openOriginal)
        diagram.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openOriginal()
          }
        })
      }
      block.replaceWith(diagram)
    }).catch(() => {
      if (!isActive() || !block.isConnected) return
      wrapWithError(block, errorLabel)
    })
  }
}

/** Keep the original code block visible and append an error note below it. */
function wrapWithError(block: HTMLElement, errorLabel: string): void {
  const wrap = document.createElement(DIAGRAM_TAG)
  wrap.className = mdMermaidClass
  block.replaceWith(wrap)
  wrap.append(block)
  const note = document.createElement('div')
  note.className = mdMermaidErrorClass
  note.textContent = errorLabel
  wrap.append(note)
}
