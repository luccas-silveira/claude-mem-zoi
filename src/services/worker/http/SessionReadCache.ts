/**
 * Session-scoped read cache — tracks which file paths have already been Read
 * during a content session, so that subsequent identical Reads can be
 * skipped by the pre-filter as duplicates.
 *
 * State is in-memory only (resets on worker restart — that's fine, the
 * pre-filter is an optimization, not a correctness gate). Edit/Write/
 * NotebookEdit operations on a tracked path invalidate the entry so the
 * next Read of that file is allowed through (its contents may have
 * changed and we want fresh observation signal).
 *
 * Pattern adapted from `RateLimitStore.ts` (last-write-wins map, in-memory
 * only, module-level singleton at the bottom).
 */

export class SessionReadCache {
  private entries = new Map<string, Set<string>>();
  // Bound memory in long-running worker; oldest session evicted on overflow.
  private maxSessions = 200;

  /** Mark `filePath` as read inside `sessionId`. No-op if either is empty. */
  markRead(sessionId: string, filePath: string): void {
    if (!sessionId || !filePath) return;
    let set = this.entries.get(sessionId);
    if (!set) {
      if (this.entries.size >= this.maxSessions) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      set = new Set<string>();
      this.entries.set(sessionId, set);
    } else {
      // Touch: move to end so it counts as most-recently-used.
      this.entries.delete(sessionId);
      this.entries.set(sessionId, set);
    }
    set.add(filePath);
  }

  /** True if `filePath` was previously Read in this session and not yet invalidated. */
  hasRead(sessionId: string, filePath: string): boolean {
    if (!sessionId || !filePath) return false;
    const set = this.entries.get(sessionId);
    if (!set) return false;
    return set.has(filePath);
  }

  /** Drop a single path from a session (e.g. after Edit/Write). */
  invalidate(sessionId: string, filePath: string): void {
    if (!sessionId || !filePath) return;
    const set = this.entries.get(sessionId);
    if (!set) return;
    set.delete(filePath);
    if (set.size === 0) {
      this.entries.delete(sessionId);
    }
  }

  /** Drop everything for a session (e.g. on session_end). */
  clearSession(sessionId: string): void {
    if (!sessionId) return;
    this.entries.delete(sessionId);
  }

  /** Drop all entries — used by tests for isolation. */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Process-wide singleton. */
export const sessionReadCache = new SessionReadCache();
