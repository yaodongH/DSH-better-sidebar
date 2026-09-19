/**
 * Interception of the chat's produced-files row: the turn-tail list entry
 * that replaces ui-deliverables' row when the closing turn produced files.
 * The takeover looks identical (same chip row); the chips open the file in
 * the sidebar instead of the host OS.
 *
 * DSH 0.1.6-alpha.2 turned this slot from `chain` into `list`, which moved the
 * seat of the claim test: a list entry is addressed by `id` (a missing `id`
 * throws at load time) and there is no selector to decline with. The row
 * therefore claims the host deliverables cell — the same `id`, at priority -1,
 * so the cell's lowest live entry wins — and runs the claim test inside the
 * component, returning null to render nothing.
 *
 * Consequence of the list shape: the host deliverables entry shares this cell
 * and is shadowed, so a decline renders an empty cell rather than falling back
 * to the host row (the chain kind could pass the owner on). Disabling the
 * editor tab type or suspending the sidebar therefore hides the row instead of
 * showing chips that open through the host OS.
 */
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import { revealPaths, type SidebarStore } from './state.ts'
import { t } from './locales.ts'
import { resolveSidebarPath, selectProducedFiles } from './produced-files.ts'
import css from './sidebar.module.css'

/** Open a file in the sidebar's editor (used by the intercepted row and the explorer). */
export function openSidebarFile(ctx: Context, store: SidebarStore, sessionId: string, path: string): void {
  const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
  const absolute = resolveSidebarPath(summary?.cwd, path)
  const at = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'))
  const title = at === -1 ? absolute : absolute.slice(at + 1)
  // Route through the sidebar service so the editor descriptor's dedupeKey
  // (per-path) applies; the id is path-derived so multiple editors coexist.
  ctx.get('betterSidebar')?.openTab({ type: 'editor', title, path: absolute, id: `editor:${absolute}` })
}

/**
 * Reveal the produced files in the sidebar explorer: expand their parent
 * directories, highlight the rows, and focus the explorer tab. Unknown
 * files fall back to revealing the workspace root itself.
 */
export function revealInExplorer(
  ctx: Context,
  store: SidebarStore,
  sessionId: string,
  files: readonly string[],
): void {
  const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
  const cwd = summary?.cwd
  // Deliverables report paths as-is (often relative to the session cwd), but
  // the explorer tree and revealPaths work on absolute paths — resolve every
  // target so the ancestors expand and the row actually matches.
  const targets = files.length > 0
    ? files.map(path => resolveSidebarPath(cwd, path))
    : cwd === undefined ? [] : [cwd]
  store.reduce(state => revealPaths(state, cwd, targets))
  // Focus the single-instance editor home tab (the files window) where the
  // reveal highlight renders. Read via ctx.get like every other internal
  // consumer (#357): the provider is not on this fiber chain, so a direct
  // ctx.betterSidebar read can throw before optional chaining applies.
  ctx.get('betterSidebar')?.openTab({ type: 'editor', title: t('files') })
}

/** The intercepted produced-files row (visual twin of the deliverables chips). */
export function SidebarProducedFiles(props: {
  matched: readonly string[]
  openInSidebar: (path: string) => void
  /** Reveal the produced files in the explorer ("Show in folder" twin). */
  onShowInFolder: (files: readonly string[]) => void
}) {
  const { matched, openInSidebar, onShowInFolder } = props
  const shown = matched.slice(0, 6)
  const hidden = matched.length - shown.length
  return (
    <div className={css.producedRow}>
      <span className={css.producedLabel}>{t('produced')}</span>
      {shown.map(path => {
        const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
        const name = at === -1 ? path : path.slice(at + 1)
        return (
          <button
            key={path}
            type="button"
            className={css.producedChip}
            title={path}
            onClick={() => { openInSidebar(path) }}
          >
            <IconCodeOutline16 size={12} />
            <span>{name}</span>
          </button>
        )
      })}
      {hidden > 0 && <span className={css.producedMore}>+{hidden}</span>}
      {hidden > 0 && (
        <button
          type="button"
          className={css.producedMore}
          style={{ cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
          onClick={() => { onShowInFolder(matched) }}
        >
          {t('showInFolder')}
        </button>
      )}
    </div>
  )
}

/**
 * The host deliverables entry's cell id. Claiming it (same id, lower priority)
 * shadows that row; a fresh id would render a second, parallel row instead.
 */
const DELIVERABLES_CELL_ID = '@deepseek-ai/dsh-client-ui-deliverables'

/**
 * Slot props the turn-tail row reads. The list kind hands each entry the Turn,
 * its closing sequence, and the file opener; the injected business face joins
 * them (see the register call below).
 */
interface TurnTailRowProps {
  /** The closing Turn — `selectProducedFiles` reads its `deliverables` data. */
  turn?: unknown
  /** Closing sequence, used to ignore deliveries recorded after this Turn. */
  seq?: unknown
  /** Injected face: open the produced file in the sidebar editor. */
  openInSidebar: (path: string) => void
  /** Injected face: reveal the produced files in the sidebar explorer. */
  onShowInFolder: (files: readonly string[]) => void
}

/**
 * Register the turn-tail interception (returns the disposer).
 *
 * The slot is a CHILD slot the host's ui-conversation declares in its
 * `conversation.chat.node` children table (kind: list, scope: session).
 * Registering it directly races the declaration — the ui-slots core's
 * load-time validation throws "not declared (a parent entry's children
 * table must declare it)" when the parent entry is not on the ledger yet.
 * slots.inject waits for the declaration: the callback runs synchronously
 * when the slot is already declared, otherwise it runs inside the declaring
 * register() call once the declaration commits; declaration collapse
 * disposes the entry and a later declaration re-registers it. This mirrors
 * @deepseek-ai/dsh-client-ui-deliverables' registration of the same slot.
 */
export function registerTurnTailInterception(ctx: Context, store: SidebarStore): () => void {
  // The claim test that the chain kind ran in `select` lives here now: a list
  // entry has no selector seat, so it either renders its row or returns null.
  const TurnTailRow = (props: TurnTailRowProps) => {
    // Decline while the editor tab type is disabled in the side card settings
    // (chips that cannot open are worse than no row), and while the sidebar is
    // externally disabled (aionui-panel chosen).
    if (store.getSuspended()) return null
    if (store.getPrefs().tabsEnabled['editor'] === false) return null
    const matched = selectProducedFiles(props)
    return matched === null ? null : <SidebarProducedFiles {...props} matched={matched} />
  }
  return ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: DELIVERABLES_CELL_ID,
    priority: -1,
    registrant: 'dsh-better-sidebar',
    inject: (sessionId: string) => ({
      openInSidebar: (path: string) => { openSidebarFile(ctx, store, sessionId, path) },
      onShowInFolder: (files: readonly string[]) => { revealInExplorer(ctx, store, sessionId, files) },
    }),
  }, TurnTailRow))
}
