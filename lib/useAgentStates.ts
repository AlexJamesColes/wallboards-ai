'use client';

import { useEffect, useMemo, useState } from 'react';
import { normalizeAgentName } from './normalizeAgentName';

/**
 * Client hook — polls one or more `/api/agent-states/<slug>` feeds and
 * returns a name-keyed lookup of each agent's live state. The sales
 * leaderboards use it to overlay an avatar rim + dim opacity on each
 * card so a glance answers both "who's selling" and "who's actually on
 * the floor right now". A leaderboard for a single office passes one
 * slug; the combined sales-group board passes both.
 *
 * Returns a Map keyed by `normalizeAgentName(name)` so the leaderboard
 * row's name (which may carry award emojis like 🥇 + the cosmetic
 * spelling that drifts from Noetica's) still finds the right state.
 */

export interface AgentLiveState {
  status:       string;     // canonicalised — see lib/agentStateMeta
  rawStatus:    string;     // exact value from Noetica
  /** Time-in-state in seconds at the moment of the last poll. The
   *  leaderboard only cares about the bucket, not the seconds, so the
   *  hook doesn't tick this forward locally — pure server-cadence. */
  timeInState:  number;
  office:       string | null;
  /** True when the agent isn't in the Noetica feed at all (server pads
   *  rostered-but-offline members with status "Not logged in"). The
   *  leaderboard dims these cards. */
  offline:      boolean;
}

interface OfficeBlock {
  label:    string;
  agents:   { name: string; status: string; time_in_state: number; team: string | null }[];
}

interface Payload {
  offices:    OfficeBlock[];
  unmatched:  { name: string; status: string; time_in_state: number; team: string | null }[];
}

const POLL_MS = 15_000;

export function useAgentStates(slugs: readonly string[]): Map<string, AgentLiveState> {
  const [snapshots, setSnapshots] = useState<Record<string, Payload | null>>({});
  const [tick, setTick] = useState(0);

  // Stable join key so the effect dep doesn't re-fire on every render
  // when the parent passes a fresh array literal.
  const joined = slugs.join('|');

  useEffect(() => {
    if (slugs.length === 0) return;
    let cancelled = false;
    const fetchAll = async () => {
      const entries = await Promise.all(slugs.map(async slug => {
        try {
          const res = await fetch(`/api/agent-states/${encodeURIComponent(slug)}`, { cache: 'no-store' });
          if (!res.ok) return [slug, null] as const;
          const d = (await res.json()) as Payload;
          return [slug, d] as const;
        } catch {
          return [slug, null] as const;
        }
      }));
      if (cancelled) return;
      setSnapshots(Object.fromEntries(entries));
    };
    fetchAll();
    return () => { cancelled = true; };
  }, [joined, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), POLL_MS);
    return () => clearInterval(iv);
  }, []);

  return useMemo(() => {
    const m = new Map<string, AgentLiveState>();
    for (const slug of slugs) {
      const payload = snapshots[slug];
      if (!payload) continue;
      for (const office of payload.offices) {
        for (const a of office.agents) {
          const key = normalizeAgentName(a.name);
          if (!key || m.has(key)) continue;
          m.set(key, {
            status:      a.status,
            rawStatus:   a.status,
            timeInState: a.time_in_state,
            office:      office.label,
            offline:     a.status === 'Not logged in',
          });
        }
      }
      for (const a of payload.unmatched) {
        const key = normalizeAgentName(a.name);
        if (!key || m.has(key)) continue;
        m.set(key, {
          status:      a.status,
          rawStatus:   a.status,
          timeInState: a.time_in_state,
          office:      null,
          offline:     a.status === 'Not logged in',
        });
      }
    }
    return m;
  }, [snapshots, joined]); // eslint-disable-line react-hooks/exhaustive-deps
}
