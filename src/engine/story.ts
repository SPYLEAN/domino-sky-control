import type { RecoveryReport } from "./recovery";
import { simulate } from "./simulate";
import { fmt, fmtDur } from "./time";
import type { Network, SimulationEvent, SimulationResult } from "./types";

export interface StoryChapter {
  index: number;
  key: "normal" | "crisis" | "first" | "cascade" | "human" | "dispatcher" | "resolution";
  kicker: string;
  headline: string;
  sentence: string;
  bullets: string[];
  flights: string[];
  airports: string[];
  tails: string[];
  connections: string[];
  eventIds: string[];
  times: { label: string; value: string }[];
  window: [number, number] | null; // timeline highlight (minutes)
  focusTime: number | null; // scrubber moment for this chapter
  useRecovered: boolean;
  evidence: string[];
  empty: boolean; // true when the scenario produced nothing of this kind
}

const n = (x: number) => x.toLocaleString("en-IN");

/** Deterministic templates turning the event ledger into seven chapters. No invented facts. */
export function buildStory(net: Network, r: SimulationResult, rep: RecoveryReport | null, appliedId: string | null = null): StoryChapter[] {
  const s = r.scenario!;
  const ap = net.airportById[s.airport];
  const ev = r.events;
  const byId = Object.fromEntries(ev.map((e) => [e.id, e]));
  const chapters: StoryChapter[] = [];
  const blank = { bullets: [], flights: [], airports: [], tails: [], connections: [], eventIds: [], times: [], window: null, focusTime: null, useRecovered: false, evidence: [], empty: false };

  // 1 — Normal operations
  const totalPax = net.flights.reduce((a, f) => a + f.pax, 0);
  chapters.push({
    ...blank, index: 1, key: "normal", kicker: "Scene 01 · Normal operations",
    headline: `${net.flights.length} flights. ${net.aircraft.filter((a) => !a.isSpare).length} aircraft. One fragile day.`,
    sentence: `On a normal day every aircraft flies a chain of flights. Each one can only leave after the aircraft lands from the previous flight and spends at least ${net.minTurnaround} minutes on the ground.`,
    bullets: [
      `${n(totalPax)} scheduled boardings across ${net.airports.length} airports.`,
      `${net.connections.length} passenger connection groups (${n(net.connections.reduce((a, c) => a + c.passengers, 0))} bookings) depend on two flights lining up.`,
      `${net.crews.length} crews, each limited to ${net.crews[0].maxDuty / 60} hours of duty. ${net.aircraft.filter((a) => a.isSpare).map((a) => `${a.tail} waits at ${a.base}`).join("; ")}.`,
      "Baseline check: every turnaround, connection and crew duty in the dataset is legal.",
    ],
    airports: net.airports.map((a) => a.id),
    tails: net.aircraft.map((a) => a.tail),
    focusTime: s.start - 60,
    evidence: (() => {
      const b = simulate(net, null);
      return [
        `Baseline re-simulation (no closure): ${b.flights.filter((f) => f.status === "on_time").length}/${b.flights.length} flights on time.`,
        `Invariant checker on baseline: ${b.violations.length} violations (turnaround ≥ ${net.minTurnaround} min, no teleporting, crew duty ≤ limit).`,
        `Connections made on baseline: ${b.connections.filter((c) => c.status === "made").length}/${b.connections.length}.`,
      ];
    })(),
  });

  // 2 — The crisis
  const closureEv = ev.find((e) => e.type === "closure_start")!;
  const scheduledThere = net.flights.filter((f) =>
    (f.origin === s.airport && f.dep >= s.start && f.dep < s.end) || (f.destination === s.airport && f.arr >= s.start && f.arr < s.end));
  chapters.push({
    ...blank, index: 2, key: "crisis", kicker: "Scene 02 · The crisis",
    headline: `${ap.city} closes ${fmt(s.start)}–${fmt(s.end)}.`,
    sentence: `For ${fmtDur(s.end - s.start)} no aircraft may take off from or land at ${ap.name} (${ap.id}).`,
    bullets: scheduledThere.length
      ? [`${scheduledThere.length} scheduled movement${scheduledThere.length > 1 ? "s" : ""} fall inside the window: ${scheduledThere.map((f) => f.id).join(", ")}.`,
        "Policy: flights are held on the ground before departure so they land only after reopening. No mid-air holding, diversions or ferry flights are modelled."]
      : ["No scheduled departure or arrival falls inside this window, so the closure itself blocks nothing directly."],
    airports: [s.airport], flights: scheduledThere.map((f) => f.id), eventIds: [closureEv.id],
    times: [{ label: "Closes", value: fmt(s.start) }, { label: "Reopens", value: fmt(s.end) }],
    window: [s.start, s.end], focusTime: s.start, empty: scheduledThere.length === 0,
    evidence: [`Closure interval [${fmt(s.start)}, ${fmt(s.end)}) at ${s.airport}: a departure or arrival at time t is blocked when ${fmt(s.start)} ≤ t < ${fmt(s.end)}.`,
      ...scheduledThere.map((f) => `${f.id} scheduled ${fmt(f.dep)}–${fmt(f.arr)} (${f.origin}→${f.destination}) intersects the closure.`)],
  });

  // 3 — First domino
  const constraints = ev.filter((e) => e.type === "closure_constraint").sort((a, b) => a.time - b.time || a.seq - b.seq);
  const first = constraints[0];
  if (first) {
    const sim = r.flightById[first.flightId!];
    const f = sim.flight;
    chapters.push({
      ...blank, index: 3, key: "first", kicker: "Scene 03 · The first domino",
      headline: `${f.id} ${f.origin}→${f.destination} is the first flight hit.`,
      sentence: first.explanation,
      bullets: [
        `Scheduled ${fmt(f.dep)}–${fmt(f.arr)}; ${sim.status === "cancelled" ? "cancelled" : `now ${fmt(sim.actualDep)}–${fmt(sim.actualArr)} (+${sim.delay} min)`}.`,
        `Aircraft ${sim.tail}, crew ${sim.crewId}, ${f.pax} passengers on board.`,
        constraints.length > 1 ? `${constraints.length} flights in total are directly constrained by the closure: ${constraints.map((c) => c.flightId).join(", ")}.` : "It is the only flight directly constrained by the closure.",
      ],
      flights: [f.id], airports: [f.origin, f.destination], tails: [sim.tail],
      eventIds: [first.id, ...sim.eventIds.filter((x) => x !== first.id)],
      times: [{ label: "Scheduled dep", value: fmt(f.dep) }, { label: "Actual dep", value: fmt(sim.actualDep) }],
      window: [f.dep, sim.actualArr ?? f.arr], focusTime: sim.actualDep ?? f.dep, evidence: sim.evidence?.formulas ?? [],
    });
  } else {
    chapters.push({
      ...blank, index: 3, key: "first", kicker: "Scene 03 · The first domino",
      headline: "No flight is directly constrained.", sentence: "No scheduled departure or arrival at the closed airport falls inside the closure, so nothing has to move.",
      empty: true, focusTime: s.start, evidence: ["No closure_constraint events were emitted for this scenario."], airports: [s.airport],
    });
  }

  // 4 — Cascade: longest aircraft chain of rotation knock-ons
  const prop = ev.filter((e) => e.type === "rotation_propagation" || (e.type === "flight_cancelled" && e.rule === "aircraft.continuity"));
  const byTail: Record<string, SimulationEvent[]> = {};
  for (const e of prop) (byTail[e.tail!] ??= []).push(e);
  const chainTail = Object.keys(byTail).sort((a, b) => byTail[b].length - byTail[a].length || a.localeCompare(b))[0];
  const outside = r.flights.filter((f) => f.status !== "on_time" && f.flight.origin !== s.airport && f.flight.destination !== s.airport);
  if (chainTail) {
    const chain = r.flights.filter((f) => f.tail === chainTail && f.status !== "on_time");
    const cities = [...new Set(chain.flatMap((f) => [f.flight.origin, f.flight.destination]))];
    chapters.push({
      ...blank, index: 4, key: "cascade", kicker: "Scene 04 · The cascade",
      headline: `The delay travels with ${chainTail} across ${cities.map((c) => net.airportById[c].city).join(", ")}.`,
      sentence: `Each late landing pushes the next take-off back, because the same aircraft must still get ${net.minTurnaround} minutes on the ground. Cities that never closed inherit the delay.`,
      bullets: [
        ...chain.map((f) => f.status === "cancelled"
          ? `${f.flight.id} ${f.flight.origin}→${f.flight.destination}: cancelled (${f.cancelReason?.replace(/_/g, " ")}).`
          : `${f.flight.id} ${f.flight.origin}→${f.flight.destination}: ${fmt(f.flight.dep)} → ${fmt(f.actualDep)} (+${f.delay} min).`),
        ...(Object.keys(byTail).length > 1 ? [`Other aircraft carrying knock-on delay: ${Object.keys(byTail).filter((t) => t !== chainTail).sort().map((t) => `${t} (${byTail[t].map((e) => e.flightId).join(", ")})`).join("; ")}.`] : []),
        `Across the network, ${outside.length} affected flight${outside.length === 1 ? "" : "s"} never touch ${s.airport}; ${Object.keys(byTail).length} aircraft carry knock-on delays.`,
      ],
      flights: r.flights.filter((f) => f.tail === chainTail).map((f) => f.flight.id), tails: [chainTail], airports: cities,
      evidence: chain.filter((f) => f.evidence).map((f) => `${f.flight.id}: ${f.evidence!.formulas[f.evidence!.binding === "aircraft_rotation" ? 0 : 2]} → departs ${fmt(f.actualDep)}`),
      eventIds: chain.flatMap((f) => f.eventIds),
      window: [chain[0].flight.dep, Math.max(...chain.map((f) => f.actualArr ?? f.flight.arr))],
      focusTime: chain[chain.length - 1].actualDep ?? chain[chain.length - 1].flight.dep,
    });
  } else {
    chapters.push({
      ...blank, index: 4, key: "cascade", kicker: "Scene 04 · The cascade",
      headline: "The ripple stops here.",
      sentence: `Every aircraft hit by the closure had enough spare ground time to absorb the delay before its next flight. No later flight was pushed back by a late aircraft.`,
      bullets: outside.length ? [`${outside.length} flights away from ${s.airport} are still affected.`] : [],
      empty: true, focusTime: s.end, evidence: ["No rotation_propagation or aircraft-continuity events were emitted for this scenario."],
    });
  }

  // 5 — Human impact
  const missed = r.connections.filter((c) => c.status !== "made");
  const crewEv = ev.filter((e) => e.type === "crew_infeasible");
  const cancelEv = ev.filter((e) => e.type === "flight_cancelled");
  const k = r.kpis;
  const humanBullets = [
    k.delayedFlights ? `${n(k.delayedPax)} passengers sit on ${k.delayedFlights} delayed flights — ${n(k.paxDelayMinutes)} passenger-minutes of delay in total.` : "No operated flight is delayed.",
    missed.length
      ? `${missed.length} connection group${missed.length > 1 ? "s" : ""} broken (${n(k.missedConnectionPax)} passengers): ${missed.map((m) => `${m.connection.id} ${m.connection.fromFlight}→${m.connection.toFlight} (${m.connection.passengers}, ${m.status === "missed" ? `short by ${-m.slack!} min` : m.status.replace(/_/g, " ")})`).join("; ")}.`
      : "Every passenger connection is still made.",
    crewEv.length
      ? `${crewEv.length} flight${crewEv.length > 1 ? "s" : ""} would push a crew past its legal duty limit: ${crewEv.map((e) => `${e.flightId} (${e.crewId}, +${e.values.overBy} min)`).join(", ")}. They are not flown.`
      : "No crew reaches its duty limit.",
    k.cancelledFlights ? `${k.cancelledFlights} flight${k.cancelledFlights > 1 ? "s" : ""} cancelled, ${n(k.cancelledPax)} booked boardings lost.` : "No flight is cancelled.",
  ];
  const atRisk = r.connections.filter((c) => c.status === "made" && c.slack! < c.baselineSlack);
  if (atRisk.length) humanBullets.push(`Squeezed but made: ${atRisk.map((c) => `${c.connection.id} (${c.slack} min spare, was ${c.baselineSlack})`).join(", ")}.`);
  chapters.push({
    ...blank, index: 5, key: "human", kicker: "Scene 05 · The human impact",
    headline: k.strandedProxy ? `${n(k.strandedProxy)} modelled stranded-passenger cases.` : "Delays, but nobody is stranded.",
    sentence: "Minutes become missed connections when the first flight lands too late for passengers to make the next one; they become cancellations when a crew would break its legal limit.",
    bullets: humanBullets,
    flights: [...new Set([...missed.flatMap((m) => [m.connection.fromFlight, m.connection.toFlight]), ...crewEv.map((e) => e.flightId!), ...cancelEv.map((e) => e.flightId!)])],
    connections: missed.map((m) => m.connection.id),
    airports: [...new Set(missed.map((m) => m.connection.airport))],
    eventIds: [...ev.filter((e) => e.type === "connection_missed" || e.type === "connection_at_risk").map((e) => e.id), ...crewEv.map((e) => e.id), ...cancelEv.map((e) => e.id)],
    focusTime: missed[0]?.outboundDep ?? crewEv[0]?.time ?? s.end,
    evidence: ["Stranded proxy = boardings on cancelled flights + passengers in connection groups missed on timing (both legs flew). Not a count of unique people."],
    empty: !missed.length && !crewEv.length && !k.cancelledFlights,
  });

  // 6 — Dispatcher
  if (rep) {
    const applied = appliedId ? rep.candidates.find((c) => c.id === appliedId && c.feasible) ?? null : null;
    const w = applied ?? rep.winner;
    const userChoice = applied && applied.id !== rep.winner.id;
    const runnerUp = rep.ranked.find((c) => c.id !== w.id && c.actions.length > 0);
    const rejectedAttractive = rep.candidates.find((c) => !c.feasible && c.result);
    chapters.push({
      ...blank, index: 6, key: "dispatcher", kicker: "Scene 06 · The dispatcher",
      headline: userChoice ? `Applied by you: ${w.title}.` : w.actions.length ? `Recommended: ${w.title}.` : "Recommended: change nothing.",
      sentence: w.actions.length
        ? `The dispatcher simulated ${rep.stats.simulated} plans in full and ranked the ${rep.stats.feasible} feasible ones by its objective. ${w.title} ranked #${w.rank}${userChoice ? " — you chose it over the #1 recommendation" : ""}.`
        : `The dispatcher simulated ${rep.stats.simulated} plans in full. None of them beat the untreated schedule under the objective, so the honest answer is to leave it.`,
      bullets: [
        ...(userChoice ? [`You applied plan #${w.rank}. The dispatcher's recommendation under this objective was #1: ${rep.winner.title}.`] : []),
        `${rep.stats.generated} options considered; ${rep.stats.prefilterRejected} ruled out before simulation (aircraft or crew not physically there).`,
        `${rep.stats.postCheckRejected} rejected after simulation; ${rep.stats.improving} feasible plans improve on doing nothing.`,
        ...(runnerUp ? [`Runner-up: ${runnerUp.title}.`] : []),
        ...(rejectedAttractive ? [`Rejected: ${rejectedAttractive.title} — ${rejectedAttractive.rejection}`] : []),
        "Label: best evaluated recovery under the displayed search scope (not a proof of global optimality).",
      ],
      flights: w.actions.flatMap((a) => a.flightIds),
      tails: w.actions.map((a) => (a.kind === "spare" ? a.spareTail : net.flightById[a.flightIds[0]].tail)),
      eventIds: (w.result?.events ?? []).filter((e) => e.type === "recovery_assignment").map((e) => e.id),
      evidence: [rep.objective, rep.scope], useRecovered: true, focusTime: s.end,
    });
    // 7 — Resolution
    const a = w.kpis!, b = r.kpis;
    const line = (label: string, x: number, y: number, unit = "") => `${label}: ${n(x)}${unit} → ${n(y)}${unit} (${y - x > 0 ? "+" : ""}${n(y - x)})`;
    const still = (w.result?.connections ?? []).filter((c) => c.status !== "made");
    chapters.push({
      ...blank, index: 7, key: "resolution", kicker: "Scene 07 · The resolution",
      headline: w.actions.length ? "Before and after, side by side." : "The disruption stands — and that is the truthful result.",
      sentence: w.actions.length ? "Every number below is the difference between two full deterministic simulations of the same day." : "No evaluated recovery reduced passenger harm, so the outcome is unchanged.",
      bullets: [
        line("Cancelled boardings", b.cancelledPax, a.cancelledPax),
        line("Missed-connection passengers", b.missedConnectionPax, a.missedConnectionPax),
        line("Passenger-delay minutes", b.paxDelayMinutes, a.paxDelayMinutes),
        line("Flight-delay minutes", b.totalFlightDelay, a.totalFlightDelay),
        line("Crew duty cancellations", b.crewDutyAlerts, a.crewDutyAlerts),
        still.length ? `Still affected: ${still.map((c) => `${c.connection.id} (${c.connection.passengers} pax)`).join(", ")}.` : "No passenger connection remains broken.",
      ],
      flights: w.actions.flatMap((x) => x.flightIds),
      eventIds: (w.result?.events ?? []).filter((e) => e.type === "recovery_assignment" || e.type === "connection_missed" || e.type === "flight_cancelled").map((e) => e.id),
      useRecovered: true, focusTime: s.end,
      evidence: ["Each figure = KPI of a full re-simulation with the plan applied − KPI of the untreated disruption (both deterministic).", `Plan id: ${w.id}`],
    });
  }
  void byId;
  return chapters;
}
