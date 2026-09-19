/**
 * Pure derivation of the on-screen conversation from the sessions list
 * snapshot.
 *
 * DSH 0.1.6-alpha.2 removed `current` from `SessionListState`: selection became
 * a private binding inside the uiSession service (`this.current`), and
 * `ISessions.list` now carries only the catalog (`ids`, `byId`, `phase`,
 * subagent catalogs, jobs). The sanctioned way to name the conversation the
 * main view is showing is the main-view retain count — the same test the host
 * runs on itself:
 *
 *   Object.values(byId).find(candidate => (candidate.retainedBy.mainView ?? 0) > 0)?.id
 *
 * (`@deepseek-ai/dsh-client-ui-session` main-binding arbitration,
 * `@deepseek-ai/dsh-client-ui-layout`'s DocumentTitle). Kept dependency-free so
 * the replica is unit-testable and easy to diff against upstream when it
 * drifts — mirroring `produced-files.ts`.
 */
import type { SidebarSessionList } from '../context-types.ts'

/**
 * The session the main view currently shows.
 * @param list - the sessions list snapshot (`ctx.sessions.list.getSnapshot()`).
 * @returns the retained session id, or undefined while nothing is on screen.
 */
export function currentSessionId(list: SidebarSessionList): string | undefined {
  for (const row of Object.values(list.byId)) {
    if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id
  }
  return undefined
}
