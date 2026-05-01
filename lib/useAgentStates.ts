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

/** Inbound queue summary shape — mirrors the agent-states API payload.
 *  Used for the leaderboard's queue banner so floor managers see calls
 *  landing without needing to flip to the agent-states view. */
export interface QueueSummary {
  label:           string;
  in_queue:        number;
  offered:         number;
  answered:        number;
  abandoned:       number;
  abandon_pct:     number;
  average_wait:    number;
  longest_wait:    number;
  queues_matched:  string[];
  queues_missing:  string[];
  updated_at:      string | null;
}

interface Payload {
  offices:    OfficeBlock[];
  unmatched:  { name: string; status: string; time_in_state: number; team: string | null }[];
  queues?:    QueueSummary[];
}

const POLL_MS = 15_000;

/** Result shape — the live agent map plus the queue summary aggregated
 *  across every polled feed. Multiple slugs (e.g. sales-group polling
 *  London + Guildford) merge their queues into one array; same-label
 *  queues are summed so the banner shows one "Inbound Sales · 5 in
 *  queue" line rather than duplicating per office. */
export interface AgentStatesResult {
  states: Map<string, AgentLiveState>;
  queues: QueueSummary[];
}

export function useAgentStates(slugs: readonly string[]): AgentStatesResult {
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
    const states = new Map<string, AgentLiveState>();
    /** Queue rows by label so the same logical queue (e.g. "Inbound
     *  Sales") polled across two offices doesn't double up. Sums the
     *  numeric counters; takes the worst-case wait time. */
    const queueByLabel = new Map<string, QueueSummary>();

    for (const slug of slugs) {
      const payload = snapshots[slug];
      if (!payload) continue;
      for (const office of payload.offices) {
        for (const a of office.agents) {
          const key = normalizeAgentName(a.name);
          if (!key || states.has(key)) continue;
          states.set(key, {
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
        if (!key || states.has(key)) continue;
        states.set(key, {
          status:      a.status,
          rawStatus:   a.status,
          timeInState: a.time_in_state,
          office:      null,
          offline:     a.status === 'Not logged in',
        });
      }
      for (const q of payload.queues || []) {
        const existing = queueByLabel.get(q.label);
        if (!existing) {
          queueByLabel.set(q.label, { ...q });
        } else {
          existing.in_queue     += q.in_queue;
          existing.offered      += q.offered;
          existing.answered     += q.answered;
          existing.abandoned    += q.abandoned;
          existing.longest_wait  = Math.max(existing.longest_wait, q.longest_wait);
          existing.average_wait  = (existing.average_wait + q.average_wait) / 2; // rough — good enough for a banner
          existing.abandon_pct   = existing.offered > 0
            ? +((existing.abandoned * 100) / existing.offered).toFixed(2)
            : 0;
        }
      }
    }
    return { states, queues: Array.from(queueByLabel.values()) };
  }, [snapshots, joined]); // eslint-disable-line react-hooks/exhaustive-deps
}
