/**
 * Per-session ambient tracking: which memories were recalled/created and
 * which topics came up. Fed by the tools, drained into a
 * `~/.brain/contexts.json` entry at session boundaries (/new, /reset) —
 * the OpenClaw port of the brain session-end contract.
 */

export type SessionState = {
  started: string;
  recalled: Set<string>;
  created: Set<string>;
  topics: Set<string>;
};

const MAX_TRACKED_SESSIONS = 200;
const MAX_TOPICS = 12;

export class SessionTracker {
  private readonly sessions = new Map<string, SessionState>();

  private ensure(sessionKey: string | undefined): SessionState {
    const key = sessionKey || "default";
    let state = this.sessions.get(key);
    if (!state) {
      state = {
        started: new Date().toISOString(),
        recalled: new Set(),
        created: new Set(),
        topics: new Set(),
      };
      this.sessions.set(key, state);
      // Bound memory usage on long-lived gateways with many sessions.
      if (this.sessions.size > MAX_TRACKED_SESSIONS) {
        const oldest = this.sessions.keys().next().value;
        if (oldest !== undefined) this.sessions.delete(oldest);
      }
    }
    return state;
  }

  noteRecall(sessionKey: string | undefined, ids: string[], query?: string): void {
    const state = this.ensure(sessionKey);
    for (const id of ids) state.recalled.add(id);
    if (query && state.topics.size < MAX_TOPICS) {
      const topic = query.trim().slice(0, 80);
      if (topic) state.topics.add(topic);
    }
  }

  noteCreated(sessionKey: string | undefined, ids: string[]): void {
    const state = this.ensure(sessionKey);
    for (const id of ids) state.created.add(id);
  }

  /** Snapshot and forget a session's tracking state (session boundary). */
  drain(sessionKey: string | undefined): {
    started: string;
    recalled: string[];
    created: string[];
    topics: string[];
  } {
    const key = sessionKey || "default";
    const state = this.sessions.get(key);
    this.sessions.delete(key);
    if (!state) {
      return { started: new Date().toISOString(), recalled: [], created: [], topics: [] };
    }
    return {
      started: state.started,
      recalled: [...state.recalled],
      created: [...state.created],
      topics: [...state.topics],
    };
  }
}
