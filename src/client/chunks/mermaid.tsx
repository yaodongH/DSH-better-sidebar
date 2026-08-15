/**
 * Lazy chunk entry: mermaid diagram rendering for the markdown preview.
 * Built as `lib/client-mermaid.js` and registered under the `mermaid`
 * registry slot — fetched only when a previewed markdown file actually
 * contains ```mermaid fences (see chunk-loader.ts). Never import this module
 * from the core bundle or the editor chunk: it pulls mermaid (~1MB+) into
 * the startup path.
 */
import mermaid from 'mermaid'

/** The scheme the current mermaid configuration was initialized for. */
let lastDark: boolean | undefined

/** Per-page diagram id counter; mermaid derives the SVG element ids from it. */
let diagramSeq = 0

/**
 * Render one mermaid diagram source to an SVG string.
 * @param source - The diagram text (the fence body).
 * @param dark - The app's resolved color scheme; selects mermaid's theme.
 * @returns The rendered `<svg>` markup; rejects on parse/render errors.
 */
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  if (lastDark !== dark) {
    // Re-initialization is idempotent; the security level stays 'strict' so
    // mermaid sanitizes its own output before it reaches innerHTML.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      fontFamily: 'inherit',
      flowchart: { htmlLabels: false },
    })
    lastDark = dark
  }
  const id = `dsh-better-sidebar-mermaid-${diagramSeq++}`
  return mermaid.render(id, source).then((result) => result.svg)
}
