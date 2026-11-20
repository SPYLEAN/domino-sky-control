import { simulate, tailLegs, validateActions } from "./simulate";
import { fmt } from "./time";
import type { DisruptionScenario, Kpis, Network, RecoveryAction, SimulationResult } from "./types";

export type Strategy = "protect_passengers" | "reduce_delay" | "min_cancellations" | "balanced";

export const STRATEGIES: Record<Strategy, { label: string; description: string; keys: string[] }> = {
  protect_passengers: {
    label: "Protect passengers",
    description: "Lexicographic: 1) fewest cancelled passenger boardings, 2) fewest missed-connection passengers, 3) least passenger-delay minutes, 4) least flight-delay minutes, 5) fewest interventions.",
    keys: ["cancelledPax", "missedConnectionPax", "paxDelayMinutes", "totalFlightDelay", "interventions"],
  },
  reduce_delay: {
    label: "Reduce total delay",
    description: "Lexicographic: 1) least passenger-delay minutes, 2) least flight-delay minutes, 3) fewest cancelled boardings, 4) fewest missed-connection passengers, 5) fewest interventions.",
    keys: ["paxDelayMinutes", "totalFlightDelay", "cancelledPax", "missedConnectionPax", "interventions"],
  },
  min_cancellations: {
    label: "Minimise cancellations",
    description: "Lexicographic: 1) fewest cancelled flights, 2) fewest cancelled boardings, 3) fewest missed-connection passengers, 4) least passenger-delay minutes, 5) fewest interventions.",
    keys: ["cancelledFlights", "cancelledPax", "missedConnectionPax", "paxDelayMinutes", "interventions"],
  },
  balanced: {
    label: "Balanced",
    description: "Weighted cost = 180 × cancelled boardings + 120 × missed-connection passengers + passenger-delay minutes (a cancellation is valued like a 3-hour delay, a missed connection like 2 hours), then fewest interventions.",
    keys: ["balancedCost", "interventions"],
  },
};

export function scoreVector(k: Kpis, s: Strategy): number[] {
  if (s === "balanced") return [k.cancelledPax * 180 + k.missedConnectionPax * 120 + k.paxDelayMinutes, k.interventions];
  return STRATEGIES[s].keys.map((key) => (k as unknown as Record<string, number>)[key]);
}

export function compareVec(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export interface Candidate {
  id: string;
  actions: RecoveryAction[];
  title: string;
  summary: string;
  feasible: boolean;
  rejection: string | null;
  checks: { rule: string; passed: boolean; detail: string }[];
  result: SimulationResult | null;
  kpis: Kpis | null;
  delta: Partial<Record<keyof Kpis, number>>;
  improves: boolean;
  rank: number | null;
  sameOutcomeAs: string | null; // a better-ranked candidate with identical KPIs (redundant option)
}

export interface JournalEntry {
  seq: number;
  type: "generation" | "prefilter_reject" | "evaluation" | "post_check_reject" | "ranking" | "selection" | "scope";
  candidateId: string | null;
  text: string;
}

export interface RecoveryReport {
  strategy: Strategy;
  objective: string;
  scope: string;
  exhaustive: boolean;
  baseline: SimulationResult;
  candidates: Candidate[]; // all generated, ranked feasible first
  ranked: Candidate[]; // feasible, ranked, includes "no intervention"
  winner: Candidate;
  noneCandidate: Candidate;
  stats: { generated: number; prefilterRejected: number; simulated: number; postCheckRejected: number; feasible: number; improving: number; combinationsEvaluated: number };
  rejectionSummary: { reason: string; count: number }[];
  journal: JournalEntry[];
}

const KPI_KEYS: (keyof Kpis)[] = [
  "flightsAffected", "delayedFlights", "cancelledFlights", "cancelledPax", "missedConnectionPax", "timingMissedConnectionPax",
  "delayedPax", "paxDelayMinutes", "totalFlightDelay", "maxDelay", "crewDutyAlerts", "strandedProxy", "interventions",
];

export function kpiDelta(before: Kpis, after: Kpis) {
  const d: Partial<Record<keyof Kpis, number>> = {};
  for (const k of KPI_KEYS) d[k] = after[k] - before[k];
  return d;
}

export function actionId(a: RecoveryAction): string {
  if (a.kind === "hold") return `HLD:${a.flightIds[0]}@${fmt(a.holdUntil).replace(":", "")}`;
  return a.kind === "cancel" ? `CXL:${a.flightIds.join("+")}` : `SPR:${a.spareTail}:${a.flightIds.join("+")}:${a.crewId}`;
}

export function describeAction(net: Network, a: RecoveryAction): { title: string; summary: string } {
  if (a.kind === "hold") {
    const f = net.flightById[a.flightIds[0]];
    const c = net.connections.find((x) => x.id === a.connectionId)!;
    return {
      title: `Hold ${f.id} until ${fmt(a.holdUntil)}`,
      summary: `Keep ${f.id} ${f.origin}→${f.destination} on the ground until ${fmt(a.holdUntil)} (scheduled ${fmt(f.dep)}) so the ${c.passengers} ${c.id} passengers arriving on ${c.fromFlight} can board. Its own ${f.pax} passengers and later legs of ${f.tail} absorb the extra wait.`,
    };
  }
  if (a.kind === "cancel") {
    const fs = a.flightIds.map((id) => net.flightById[id]);
    const pax = fs.reduce((s, f) => s + f.pax, 0);
    const route = [fs[0].origin, ...fs.map((f) => f.destination)].join("→");
    return a.label === "round_trip"
      ? { title: `Cancel round trip ${a.flightIds.join(" + ")}`, summary: `Cancel ${route} on ${fs[0].tail} (${pax} booked boardings) so the aircraft stays at ${fs[0].origin} and absorbs delay before its next departure at ${fmt(net.flightById[tailLegs(net, fs[0].tail)[fs[fs.length - 1].legOrder]?.id]?.dep)}.` }
      : { title: `Cancel ${a.flightIds.join(" + ")}`, summary: `Cancel the rest of ${fs[0].tail}'s day from ${fs[0].id} (${route}, ${pax} booked boardings).` };
  }
  const fs = a.flightIds.map((id) => net.flightById[id]);
  const route = [fs[0].origin, ...fs.map((f) => f.destination)].join("→");
  const ownCrew = net.crewByFlight[fs[0].id] === a.crewId;
  return {
    title: `Spare ${a.spareTail} flies ${a.flightIds.join(" + ")}`,
    summary: `${a.spareTail}, parked at ${fs[0].origin}, operates ${route} in place of ${a.originalTail}, flown by ${ownCrew ? `the scheduled crew ${a.crewId}` : `crew ${a.crewId}, who finish their own day at ${fs[0].origin}`}.${a.form === "round_trip_cover" ? ` ${a.originalTail} waits at ${fs[0].origin} and resumes its rotation afterwards.` : ` ${a.originalTail} ends its day at ${fs[0].origin}.`}`,
  };
}

export function runRecovery(net: Network, scenario: DisruptionScenario, strategy: Strategy = "protect_passengers"): RecoveryReport {
  const journal: JournalEntry[] = [];
  const log = (type: JournalEntry["type"], text: string, candidateId: string | null = null) =>
    journal.push({ seq: journal.length + 1, type, candidateId, text });

  const baseline = simulate(net, scenario);
  const affectedTails = [...new Set(baseline.flights.filter((f) => f.status !== "on_time").map((f) => f.flight.tail))].sort();
  for (const c of baseline.connections) if (c.status !== "made") {
    affectedTails.push(net.flightById[c.connection.fromFlight].tail, net.flightById[c.connection.toFlight].tail);
  }
  const tails = [...new Set(affectedTails)].sort();
  log("scope", `Search scope: rotations of the ${tails.length} aircraft with a delayed or cancelled flight or a broken connection (${tails.join(", ") || "none"}); spares ${net.aircraft.filter((a) => a.isSpare).map((a) => `${a.tail}@${a.base}`).join(", ")}; dataset crews only.`);

  // ---- generate single actions
  const raw: { action: RecoveryAction; pre: string[] }[] = [];
  const prefilterReasons: Record<string, number> = {};
  const spares = net.aircraft.filter((a) => a.isSpare);
  for (const c of baseline.connections) {
    if (c.status !== "missed") continue;
    const holdUntil = c.inboundArr! + c.connection.minConnect;
    // one hold per onward flight: if several groups feed it, the longest required hold wins
    const existing = raw.findIndex((r) => r.action.kind === "hold" && r.action.flightIds[0] === c.connection.toFlight);
    if (existing >= 0) {
      const ex = raw[existing].action as Extract<RecoveryAction, { kind: "hold" }>;
      if (ex.holdUntil >= holdUntil) continue;
      raw.splice(existing, 1);
    }
    raw.push({ action: { kind: "hold", flightIds: [c.connection.toFlight], connectionId: c.connection.id, holdUntil }, pre: [] });
  }
  for (const tail of tails) {
    const legs = tailLegs(net, tail);
    for (let i = 0; i < legs.length; i++) {
      const remainingOperated = legs.slice(i).some((l) => baseline.flightById[l.id].status !== "cancelled");
      if (!remainingOperated) continue;
      if (i + 1 < legs.length && legs[i + 1].destination === legs[i].origin) {
        raw.push({ action: { kind: "cancel", label: "round_trip", flightIds: [legs[i].id, legs[i + 1].id] }, pre: [] });
      }
      raw.push({ action: { kind: "cancel", label: "truncate", flightIds: legs.slice(i).map((l) => l.id) }, pre: [] });
      for (const sp of spares) {
        if (legs[i].origin !== sp.base) {
          const r = `Spare not physically at departure airport (${sp.tail} is at ${sp.base}; no ferry flights in data)`;
          prefilterReasons[r] = (prefilterReasons[r] ?? 0) + 1;
          continue;
        }
        const spans: { ids: string[]; form: "takeover" | "round_trip_cover" }[] = [{ ids: legs.slice(i).map((l) => l.id), form: "takeover" }];
        for (let j = i + 1; j < legs.length - 1 && j < i + 4; j++) {
          if (legs[j].destination === sp.base) spans.push({ ids: legs.slice(i, j + 1).map((l) => l.id), form: "round_trip_cover" });
        }
        for (const span of spans) {
          for (const crew of net.crews) {
            const action: RecoveryAction = { kind: "spare", spareTail: sp.tail, originalTail: tail, flightIds: span.ids, crewId: crew.id, form: span.form };
            const pre = validateActions(net, [action]);
            if (pre.length) {
              const r = pre[0].replace(/CR\d+|DS\d+|VT-DS\d+|\b[A-Z]{3}\b/g, "…");
              const key = r.includes("ends its day") ? "Crew not physically at the spare's airport" : r.includes("free before") ? "Crew still on its own duty at that time" : r;
              prefilterReasons[key] = (prefilterReasons[key] ?? 0) + 1;
              continue;
            }
            raw.push({ action, pre });
          }
        }
      }
    }
  }
  const prefilterRejected = Object.values(prefilterReasons).reduce((a, b) => a + b, 0);
  log("generation", `Generated ${raw.length} structurally valid single actions; ${prefilterRejected} spare/crew pairings rejected before simulation by location or availability checks.`);
  for (const [r, n] of Object.entries(prefilterReasons)) log("prefilter_reject", `${n} × ${r}`);

  const candidates: Candidate[] = [];
  const evaluate = (actions: RecoveryAction[]): Candidate => {
    const id = actions.length ? `C-${actions.map(actionId).join("|")}` : "C-NONE";
    const desc = actions.length
      ? actions.map((a) => describeAction(net, a)).reduce((acc, d, i) => i === 0 ? d : { title: `${acc.title} & ${d.title}`, summary: `${acc.summary} ${d.summary}` })
      : { title: "Preserve current schedule", summary: "No intervention: operate the disrupted schedule as the simulator computed it." };
    const checks: Candidate["checks"] = [];
    const pre = validateActions(net, actions);
    checks.push({ rule: "structural", passed: pre.length === 0, detail: pre.length ? pre.join(" ") : "Aircraft at correct airport, legs consecutive, resources not double-committed." });
    if (pre.length) {
      return { id, actions, ...desc, feasible: false, rejection: pre[0], checks, result: null, kpis: null, delta: {}, improves: false, rank: null, sameOutcomeAs: null };
    }
    const result = simulate(net, scenario, actions);
    checks.push({ rule: "invariants", passed: result.violations.length === 0, detail: result.violations.length ? result.violations.join("; ") : "Turnaround ≥ 30m, no teleporting, closure respected, crew duty legal." });
    let rejection: string | null = result.violations[0] ?? null;
    for (const a of actions) {
      if (a.kind !== "spare") continue;
      const failed = a.flightIds.map((fid) => result.flightById[fid]).filter((s) => s.status === "cancelled");
      const ok = failed.length === 0;
      checks.push({
        rule: "reassigned_legs_operate", passed: ok,
        detail: ok ? `All legs moved to ${a.spareTail} operate legally with crew ${a.crewId}.` : `${failed.map((f) => `${f.flight.id} (${f.cancelReason?.replace(/_/g, " ")})`).join(", ")} would not operate on ${a.spareTail}.`,
      });
      if (!ok && !rejection) rejection = `Crew ${a.crewId} cannot legally fly ${failed[0].flight.id} on ${a.spareTail}: ${failed[0].cancelReason === "crew_duty_limit" ? `duty would reach ${failed[0].evidence?.crewDuty?.dutyMins}m of ${failed[0].evidence?.crewDuty?.maxDuty}m` : failed[0].cancelReason?.replace(/_/g, " ")}.`;
    }
    const feasible = rejection === null;
    return {
      id, actions, ...desc, feasible, rejection, checks, result, kpis: result.kpis,
      delta: kpiDelta(baseline.kpis, result.kpis), improves: false, rank: null, sameOutcomeAs: null,
    };
  };

  const none = evaluate([]);
  candidates.push(none);
  for (const r of raw) {
    const c = evaluate([r.action]);
    candidates.push(c);
    log(c.feasible ? "evaluation" : "post_check_reject", c.feasible
      ? `${c.id}: simulated — cancelled boardings ${c.kpis!.cancelledPax}, missed-connection pax ${c.kpis!.missedConnectionPax}, pax-delay ${c.kpis!.paxDelayMinutes} min.`
      : `${c.id}: rejected after simulation — ${c.rejection}`, c.id);
  }

  const baseVec = scoreVector(baseline.kpis, strategy);
  const cmp = (a: Candidate, b: Candidate) =>
    compareVec(scoreVector(a.kpis!, strategy), scoreVector(b.kpis!, strategy)) || a.actions.length - b.actions.length || a.id.localeCompare(b.id);

  // ---- bounded beam: combine the best distinct-tail singles pairwise
  const singles = candidates.filter((c) => c.feasible && c.actions.length === 1).sort(cmp);
  const beam = singles.slice(0, 8);
  let combinationsEvaluated = 0;
  for (let i = 0; i < beam.length; i++) {
    for (let j = i + 1; j < beam.length; j++) {
      const a = beam[i].actions[0], b = beam[j].actions[0];
      const tA = a.kind === "spare" ? a.originalTail : net.flightById[a.flightIds[0]].tail;
      const tB = b.kind === "spare" ? b.originalTail : net.flightById[b.flightIds[0]].tail;
      if (tA === tB) continue;
      if (validateActions(net, [a, b]).length) continue;
      const c = evaluate([a, b].sort((x, y) => actionId(x).localeCompare(actionId(y))));
      combinationsEvaluated++;
      candidates.push(c);
      log(c.feasible ? "evaluation" : "post_check_reject", c.feasible
        ? `${c.id}: combination simulated — cancelled boardings ${c.kpis!.cancelledPax}, missed-connection pax ${c.kpis!.missedConnectionPax}, pax-delay ${c.kpis!.paxDelayMinutes} min.`
        : `${c.id}: combination rejected — ${c.rejection}`, c.id);
    }
  }
  log("generation", `Beam search combined the top ${beam.length} single actions on different aircraft: ${combinationsEvaluated} two-action plans evaluated.`);

  const ranked = candidates.filter((c) => c.feasible).sort(cmp);
  ranked.forEach((c, i) => {
    c.rank = i + 1;
    c.improves = compareVec(scoreVector(c.kpis!, strategy), baseVec) < 0;
  });
  const seenOutcome = new Map<string, string>();
  for (const c of ranked) {
    const { interventions: _i, ...rest } = c.kpis!;
    void _i;
    const key = JSON.stringify(rest);
    if (seenOutcome.has(key)) c.sameOutcomeAs = seenOutcome.get(key)!;
    else seenOutcome.set(key, c.id);
  }
  const winner = ranked[0];
  const improving = ranked.filter((c) => c.improves).length;
  log("ranking", `Ranked ${ranked.length} feasible plans (including no intervention) by: ${STRATEGIES[strategy].description}`);
  log("selection", winner.actions.length === 0
    ? `No evaluated plan beats leaving the schedule as it is under "${STRATEGIES[strategy].label}". Recommendation: preserve current schedule.`
    : `Selected ${winner.id} — best evaluated recovery under the displayed search scope.`, winner.id);

  const sorted = [...ranked, ...candidates.filter((c) => !c.feasible)];
  const rejectionSummary = [
    ...Object.entries(prefilterReasons).map(([reason, count]) => ({ reason, count })),
    ...Object.entries(candidates.filter((c) => !c.feasible).reduce<Record<string, number>>((acc, c) => {
      const k = (c.rejection ?? "").includes("duty") ? "Reassigned crew would exceed duty limit" : (c.rejection ?? "Other");
      acc[k] = (acc[k] ?? 0) + 1; return acc;
    }, {})).map(([reason, count]) => ({ reason, count })),
  ];
  return {
    strategy,
    objective: STRATEGIES[strategy].description,
    scope: journal[0].text,
    exhaustive: false,
    baseline,
    candidates: sorted,
    ranked,
    winner,
    noneCandidate: none,
    stats: {
      generated: raw.length + 1 + combinationsEvaluated + prefilterRejected,
      prefilterRejected,
      simulated: candidates.filter((c) => c.result).length,
      postCheckRejected: candidates.filter((c) => c.result && !c.feasible).length,
      feasible: ranked.length,
      improving,
      combinationsEvaluated,
    },
    rejectionSummary,
    journal,
  };
}
