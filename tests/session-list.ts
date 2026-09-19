/**
 * Sessions-list fixture builder for the specs.
 *
 * DSH 0.1.6-alpha.2 dropped `current` from `SessionListState`: the on-screen
 * conversation is now the row the main view retains (`retainedBy.mainView`),
 * resolved in production by `src/client/session-current.ts`. Fixtures keep
 * expressing the intent — "this id is the current conversation" — and this
 * helper turns it into the retain count the production reader consumes, so the
 * migration lives in one place instead of every spec.
 */
import type { SidebarSessionList, SidebarSessionSummary } from '../src/context-types.ts'

/**
 * A snapshot in fixture form: `byId` plus the id the main view shows. The
 * remaining fields mirror the runtime snapshot.
 */
export interface SessionListFixture {
  /** The conversation the main view shows, if any. */
  current?: string
  byId: Record<string, SidebarSessionSummary>
  ids?: readonly string[]
  subagentsByParent?: SidebarSessionList['subagentsByParent']
  jobsBySession?: SidebarSessionList['jobsBySession']
}

/**
 * Build the runtime snapshot from a fixture.
 * @param fixture - catalog rows plus the id the main view shows.
 * @returns the snapshot the sidebar's list feed would publish.
 */
export function sessionList(fixture: SessionListFixture): SidebarSessionList {
  const { current, byId, ...rest } = fixture
  const rows: Record<string, SidebarSessionSummary> = {}
  for (const [id, row] of Object.entries(byId)) {
    rows[id] = id === current ? { ...row, retainedBy: { mainView: 1 } } : row
  }
  return { ...rest, byId: rows }
}
