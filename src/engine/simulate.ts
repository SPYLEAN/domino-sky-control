import { fmt } from "./time";
import type {
  BindingConstraint, CancelReason, CapacityRecord, CauseEvidence, ConnectionOutcome, CrewDutyRecord,
  DisruptionScenario, EventType, Flight, Kpis, Network, RecoveryAction, SimulatedFlight,
  SimulationEvent, SimulationResult,
} from "./types";

export const MIN_CLOSURE = 15;
export const MAX_CLOSURE = 720;

/** Validates a user scenario. Returns a list of problems (empty = valid). */
export function validateScenario(net: Network, s: DisruptionScenario): string[] {
  const p: string[] = [];
  if (!net.airportById[s.airport]) p.push(`Unknown airport "${s.airport}".`);
  if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) p.push("Times must be whole minutes.");
  if (s.start < 0 || s.start >= 1440) p.push("Closure must start within the operating day (00:00–23:59).");
  const dur = s.end - s.start;
  if (!(dur > 0)) p.push("Closure duration must be greater than zero.");
  else if (dur < MIN_CLOSURE) p.push(`Closure must last at least ${MIN_CLOSURE} minutes.`);
  else if (dur > MAX_CLOSURE) p.push(`Closure may last at most ${MAX_CLOSURE} minutes.`);
  return p;
}

const inClosure = (s: DisruptionScenario | null, airport: string, t: number) =>
  !!s && s.airport === airport && t >= s.start && t < s.end;

export function tailLegs(net: Network, tail: string): Flight[] {
  return net.flights.filter((f) => f.tail === tail).sort((a, b) => a.legOrder - b.legOrder);
}

/** Checks recovery actions for structural feasibility before simulation. Returns problems (empty = valid). */
export function validateActions(net: Network, actions: RecoveryAction[]): string[] {
  const p: string[] = [];
  const usedSpares = new Set<string>();
  const usedCrews = new Set<string>();
  const touched = new Set<string>();
  for (const a of actions) {
    for (const fid of a.flightIds) {
      if (!net.flightById[fid]) { p.push(`Unknown flight ${fid}.`); continue; }
      if (touched.has(fid)) p.push(`Flight ${fid} is targeted by more than one action.`);
      touched.add(fid);
    }
    if (a.kind === "cancel") {
      if (a.flightIds.length === 0) p.push("Cancellation action lists no flights.");
      continue;
    }
    if (a.kind === "hold") {
      const c = net.connections.find((x) => x.id === a.connectionId);
      if (!c) { p.push(`Unknown connection ${a.connectionId}.`); continue; }
      if (c.toFlight !== a.flightIds[0]) p.push(`${a.flightIds[0]} is not the onward flight of ${c.id}.`);
      const f = net.flightById[a.flightIds[0]];
      if (f && !(a.holdUntil > f.dep)) p.push("A hold must be later than the scheduled departure.");
      if (f && a.holdUntil - f.dep > 180) p.push("Holds longer than 180 minutes are not considered.");
      continue;
    }
    const spare = net.aircraftByTail[a.spareTail];
    if (!spare || !spare.isSpare) { p.push(`${a.spareTail} is not a spare aircraft in the dataset.`); continue; }
    if (usedSpares.has(a.spareTail)) p.push(`Spare ${a.spareTail} is already committed to another operation.`);
    usedSpares.add(a.spareTail);
    const crew = net.crewById[a.crewId];
    if (!crew) { p.push(`Unknown crew ${a.crewId}.`); continue; }
    if (usedCrews.has(a.crewId)) p.push(`Crew ${a.crewId} is already committed to another reassignment.`);
    usedCrews.add(a.crewId);
    const legs = tailLegs(net, a.originalTail);
    const idx = legs.findIndex((f) => f.id === a.flightIds[0]);
    if (idx < 0) { p.push(`${a.flightIds[0]} is not operated by ${a.originalTail}.`); continue; }
    for (let i = 0; i < a.flightIds.length; i++) {
      if (legs[idx + i]?.id !== a.flightIds[i]) p.push(`Spare legs must be consecutive legs of ${a.originalTail}.`);
    }
    const first = net.flightById[a.flightIds[0]];
    const last = net.flightById[a.flightIds[a.flightIds.length - 1]];
    if (first.origin !== spare.base) p.push(`Spare ${a.spareTail} is physically at ${spare.base}, not at ${first.origin} where ${first.id} departs.`);
    if (a.form === "takeover" && legs[legs.length - 1].id !== last.id) p.push("A takeover must cover the rest of the rotation.");
    if (a.form === "round_trip_cover" && last.destination !== first.origin) p.push("A round-trip cover must return the spare to its base.");
    if (a.crewId !== net.crewByFlight[first.id]) {
      const own = crew.flightIds.map((id) => net.flightById[id]);
      const lastOwn = own[own.length - 1];
      if (lastOwn.destination !== first.origin) p.push(`Crew ${a.crewId} ends its day at ${lastOwn.destination}, not ${first.origin}.`);
      if (lastOwn.arr + net.minTurnaround > first.dep) p.push(`Crew ${a.crewId} is not scheduled to be free before ${first.id}.`);
    }
  }
  return p;
}

interface Pos { loc: string; ready: number; prev: string | null; prevArr: number | null; lastCancelled: string | null }

export function simulate(net: Network, scenario: DisruptionScenario | null, actions: RecoveryAction[] = []): SimulationResult {
  if (scenario) {
    const sp = validateScenario(net, scenario);
    if (sp.length) throw new Error(`Invalid scenario: ${sp.join(" ")}`);
  }
  const ap = validateActions(net, actions);
  if (ap.length) throw new Error(`Infeasible actions: ${ap.join(" ")}`);

  const TAT = net.minTurnaround;
  // --- assignments (fresh copies; the network is never mutated)
  const tailOf: Record<string, string> = {};
  const crewOf: Record<string, string> = {};
  for (const f of net.flights) { tailOf[f.id] = f.tail; crewOf[f.id] = net.crewByFlight[f.id]; }
  const cancelledByAction = new Map<string, number>(); // flight -> action index
  const holdOf = new Map<string, { until: number; action: number }>();
  actions.forEach((a, i) => {
    if (a.kind === "cancel") a.flightIds.forEach((fid) => cancelledByAction.set(fid, i));
    else if (a.kind === "hold") holdOf.set(a.flightIds[0], { until: a.holdUntil, action: i });
    else a.flightIds.forEach((fid) => { tailOf[fid] = a.spareTail; crewOf[fid] = a.crewId; });
  });

  const order = [...net.flights].sort((a, b) => a.dep - b.dep || a.id.localeCompare(b.id));
  const acPos: Record<string, Pos> = {};
  for (const ac of net.aircraft) acPos[ac.tail] = { loc: ac.base, ready: ac.availableFrom, prev: null, prevArr: null, lastCancelled: null };
  const crewPos: Record<string, Pos> = {};
  for (const c of net.crews) crewPos[c.id] = { loc: c.base, ready: c.dutyStart, prev: null, prevArr: null, lastCancelled: null };

  // --- event ledger
  const events: SimulationEvent[] = [];
  const flightEvent: Record<string, string> = {};
  const add = (e: Omit<SimulationEvent, "id" | "seq">): string => {
    const seq = events.length + 1;
    const id = `EV-${String(seq).padStart(3, "0")}`;
    events.push({ ...e, id, seq });
    return id;
  };
  const base = { airport: null, flightId: null, tail: null, crewId: null, connectionId: null, parentId: null } as const;

  let closureStartId: string | null = null;
  if (scenario) {
    const a = net.airportById[scenario.airport];
    closureStartId = add({
      ...base, type: "closure_start", time: scenario.start, airport: scenario.airport,
      prevState: "open", newState: "closed", rule: "closure.no_departures_or_arrivals",
      explanation: `${a.city} (${a.id}) closes at ${fmt(scenario.start)}. No aircraft may take off or land there until ${fmt(scenario.end)}.`,
      values: { start: fmt(scenario.start), end: fmt(scenario.end), durationMin: scenario.end - scenario.start },
    });
  }
  const actionEvent: string[] = actions.map((a) => {
    const first = net.flightById[a.flightIds[0]];
    if (a.kind === "cancel") {
      return add({
        ...base, type: "recovery_assignment", time: first.dep, airport: first.origin, flightId: first.id, tail: first.tail,
        prevState: "scheduled", newState: "cancelled_by_dispatcher", rule: "recovery.cancel",
        explanation: `Dispatcher plan: cancel ${a.flightIds.join(" + ")} on ${first.tail}.`,
        values: { flights: a.flightIds.join(","), pax: a.flightIds.reduce((s, id) => s + net.flightById[id].pax, 0) },
      });
    }
    if (a.kind === "hold") {
      const c = net.connections.find((x) => x.id === a.connectionId)!;
      return add({
        ...base, type: "recovery_assignment", time: first.dep, airport: first.origin, flightId: first.id, tail: first.tail, connectionId: c.id,
        prevState: `dep ${fmt(first.dep)}`, newState: `held until ${fmt(a.holdUntil)}`, rule: "recovery.hold_for_connection",
        explanation: `Dispatcher plan: hold ${first.id} at ${first.origin} until ${fmt(a.holdUntil)} so the ${c.passengers} passengers arriving on ${c.fromFlight} (${c.id}) can board.`,
        values: { holdUntil: fmt(a.holdUntil), connection: c.id, passengers: c.passengers },
      });
    }
    return add({
      ...base, type: "recovery_assignment", time: first.dep, airport: first.origin, flightId: first.id, tail: a.spareTail, crewId: a.crewId,
      prevState: `operated_by_${a.originalTail}`, newState: `operated_by_${a.spareTail}`, rule: "recovery.spare_assignment",
      explanation: `Dispatcher plan: spare ${a.spareTail}, parked at ${first.origin}, flies ${a.flightIds.join(" → ")} instead of ${a.originalTail}, operated by crew ${a.crewId}.`,
      values: { spare: a.spareTail, originalTail: a.originalTail, crew: a.crewId, flights: a.flightIds.join(",") },
    });
  });

  const sims: SimulatedFlight[] = [];
  for (const f of order) {
    const tail = tailOf[f.id];
    const crewId = crewOf[f.id];
    const crew = net.crewById[crewId];
    const ac = acPos[tail];
    const cp = crewPos[crewId];
    const sim: SimulatedFlight = {
      flight: f, tail, crewId, status: "on_time", actualDep: null, actualArr: null, delay: 0,
      cancelReason: null, cancelCauseFlight: null, evidence: null, rootEventId: null, eventIds: [],
    };
    const cancel = (reason: CancelReason, causeFlight: string | null, parentId: string | null, explanation: string, rule: string, values: SimulationEvent["values"] = {}) => {
      sim.status = "cancelled"; sim.cancelReason = reason; sim.cancelCauseFlight = causeFlight;
      const id = add({
        ...base, type: "flight_cancelled", time: f.dep, airport: f.origin, flightId: f.id, tail, crewId,
        prevState: "scheduled", newState: "cancelled", parentId, rule, explanation,
        values: { pax: f.pax, scheduledDep: fmt(f.dep), ...values },
      });
      sim.eventIds.push(id); flightEvent[f.id] = id;
      ac.lastCancelled = f.id; cp.lastCancelled = f.id;
    };

    if (cancelledByAction.has(f.id)) {
      cancel("dispatcher_cancellation", null, actionEvent[cancelledByAction.get(f.id)!],
        `${f.id} ${f.origin}→${f.destination} is cancelled by the recovery plan; its ${f.pax} passengers lose this flight.`, "recovery.cancel");
      sims.push(sim); continue;
    }
    if (ac.loc !== f.origin) {
      const cause = ac.lastCancelled;
      cancel("aircraft_out_of_position", cause, cause ? flightEvent[cause] : null,
        `${f.id} cannot operate: aircraft ${tail} is at ${ac.loc}, not at ${f.origin}${cause ? `, because ${cause} did not fly` : ""}. No ferry flights exist in the dataset.`,
        "aircraft.continuity", { aircraftLocation: ac.loc, requiredLocation: f.origin });
      sims.push(sim); continue;
    }
    if (cp.loc !== f.origin) {
      const cause = cp.lastCancelled;
      cancel("crew_out_of_position", cause, cause ? flightEvent[cause] : null,
        `${f.id} cannot operate: crew ${crewId} is at ${cp.loc}, not at ${f.origin}${cause ? `, because ${cause} did not fly` : ""}.`,
        "crew.continuity", { crewLocation: cp.loc, requiredLocation: f.origin });
      sims.push(sim); continue;
    }

    const acft = net.aircraftByTail[tail];
    const acReady = ac.prev ? ac.prevArr! + TAT : acft.availableFrom;
    const crReady = cp.prev ? cp.prevArr! + TAT : crew.dutyStart;
    const hold = holdOf.get(f.id);
    const holdUntil = hold?.until ?? -Infinity;
    const earliest = Math.max(f.dep, acReady, crReady, holdUntil);
    let binding: BindingConstraint = "schedule";
    let bindingFlight: string | null = null;
    if (earliest > f.dep) {
      if (holdUntil > Math.max(acReady, crReady)) { binding = "connection_hold"; }
      else if (acReady >= crReady) { binding = ac.prev ? "aircraft_rotation" : "spare_availability"; bindingFlight = ac.prev; }
      else { binding = "crew_connection"; bindingFlight = cp.prev; }
    }
    const formulas: string[] = [
      `aircraft_ready = ${ac.prev ? `arr(${ac.prev}) ${fmt(ac.prevArr)} + ${TAT}m turnaround` : `${acft.isSpare ? "spare available_from" : "first leg of day"}`} = ${fmt(acReady)}`,
      `crew_ready = ${cp.prev ? `arr(${cp.prev}) ${fmt(cp.prevArr)} + ${TAT}m` : `duty_start(${crewId})`} = ${fmt(crReady)}`,
      `earliest = max(scheduled ${fmt(f.dep)}, aircraft ${fmt(acReady)}, crew ${fmt(crReady)}${hold ? `, dispatcher hold ${fmt(hold.until)}` : ""}) = ${fmt(earliest)}`,
    ];
    let dep = earliest;
    let closureDepartureShift: CauseEvidence["closureDepartureShift"] = null;
    let closureArrivalHold: CauseEvidence["closureArrivalHold"] = null;
    if (scenario && inClosure(scenario, f.origin, dep)) {
      closureDepartureShift = { applied: true, from: dep, to: scenario.end };
      formulas.push(`departure ${fmt(dep)} falls in ${f.origin} closure [${fmt(scenario.start)}, ${fmt(scenario.end)}) → depart at reopening ${fmt(scenario.end)}`);
      dep = scenario.end; binding = "closure_departure"; bindingFlight = null;
    }
    if (scenario && inClosure(scenario, f.destination, dep + f.block)) {
      const held = scenario.end - f.block;
      closureArrivalHold = { applied: true, projectedArr: dep + f.block, heldDep: held };
      formulas.push(`projected arrival ${fmt(dep + f.block)} falls in ${f.destination} closure → ground hold at ${f.origin}: depart ${fmt(scenario.end)} − ${f.block}m block = ${fmt(held)}`);
      dep = held; binding = "closure_arrival_hold"; bindingFlight = null;
    }
    const arr = dep + f.block;
    formulas.push(`arrival = departure ${fmt(dep)} + block ${f.block}m = ${fmt(arr)}`);
    const dutyMins = arr - crew.dutyStart;
    const legal = dutyMins <= crew.maxDuty;
    formulas.push(`crew duty = arrival ${fmt(arr)} − duty_start ${fmt(crew.dutyStart)} = ${dutyMins}m (limit ${crew.maxDuty}m) → ${legal ? "legal" : "ILLEGAL"}`);
    const evidence: CauseEvidence = {
      scheduledDep: f.dep,
      aircraftReady: { value: acReady, prevFlight: ac.prev, prevArr: ac.prevArr, turnaround: TAT, source: ac.prev ? "previous_leg" : acft.isSpare ? "spare_available_from" : "first_leg" },
      crewReady: { value: crReady, prevFlight: cp.prev, prevArr: cp.prevArr, turnaround: TAT, crewId },
      earliestBeforeClosure: earliest, closureDepartureShift, closureArrivalHold, binding, bindingFlight,
      crewDuty: { crewId, dutyStart: crew.dutyStart, dutyEnd: arr, dutyMins, maxDuty: crew.maxDuty, legal },
      formulas,
    };
    sim.evidence = evidence;

    const delay = dep - f.dep;
    let causeEventId: string | null = null;
    if (delay > 0) {
      if (binding === "closure_departure" || binding === "closure_arrival_hold") {
        const ce = add({
          ...base, type: "closure_constraint", time: f.dep, airport: binding === "closure_departure" ? f.origin : f.destination,
          flightId: f.id, tail, crewId, prevState: `dep ${fmt(earliest)}`, newState: `dep ${fmt(dep)}`, parentId: closureStartId,
          rule: binding === "closure_departure" ? "closure.departure_blocked" : "closure.arrival_ground_hold",
          explanation: binding === "closure_departure"
            ? `${f.id} could not take off from closed ${f.origin} at ${fmt(earliest)}; it must wait for reopening at ${fmt(scenario!.end)}.`
            : `${f.id} would have landed at closed ${f.destination} at ${fmt(earliest + f.block)}; it is held on the ground at ${f.origin} so it lands at reopening ${fmt(scenario!.end)}.`,
          values: { scheduledDep: fmt(f.dep), earliest: fmt(earliest), newDep: fmt(dep), closureEnd: fmt(scenario!.end), block: f.block },
        });
        sim.eventIds.push(ce); causeEventId = ce;
      } else if (binding === "aircraft_rotation" || binding === "crew_connection") {
        const isAc = binding === "aircraft_rotation";
        const prevArr = isAc ? ac.prevArr! : cp.prevArr!;
        const ce = add({
          ...base, type: "rotation_propagation", time: f.dep, airport: f.origin, flightId: f.id, tail, crewId,
          prevState: `dep ${fmt(f.dep)}`, newState: `dep ${fmt(dep)}`, parentId: bindingFlight ? flightEvent[bindingFlight] ?? null : null,
          rule: isAc ? "aircraft.min_turnaround" : "crew.min_connection",
          explanation: isAc
            ? `${f.id} waits for its aircraft ${tail}, which arrived late on ${bindingFlight} at ${fmt(prevArr)}. With the ${TAT}-minute minimum turnaround it can leave no earlier than ${fmt(prevArr + TAT)}.`
            : `${f.id} waits for its crew ${crewId}, who arrived on ${bindingFlight} at ${fmt(prevArr)} and need ${TAT} minutes before the next departure.`,
          values: { upstream: bindingFlight, upstreamArr: fmt(prevArr), turnaround: TAT, scheduledDep: fmt(f.dep), newDep: fmt(dep) },
        });
        sim.eventIds.push(ce); causeEventId = ce;
      } else if (binding === "connection_hold") {
        causeEventId = actionEvent[hold!.action];
      } else if (binding === "spare_availability") {
        const ce = add({
          ...base, type: "rotation_propagation", time: f.dep, airport: f.origin, flightId: f.id, tail, crewId,
          prevState: `dep ${fmt(f.dep)}`, newState: `dep ${fmt(dep)}`, parentId: null, rule: "spare.available_from",
          explanation: `${f.id} waits until spare ${tail} becomes available at ${fmt(acReady)}.`, values: { availableFrom: fmt(acReady) },
        });
        sim.eventIds.push(ce); causeEventId = ce;
      }
    }

    if (!legal) {
      const ie = add({
        ...base, type: "crew_infeasible", time: dep, airport: f.origin, flightId: f.id, tail, crewId,
        prevState: "legal", newState: "would_exceed_duty", parentId: causeEventId ?? (bindingFlight ? flightEvent[bindingFlight] ?? null : null),
        rule: "crew.max_duty",
        explanation: `Crew ${crewId} started duty at ${fmt(crew.dutyStart)}. Flying ${f.id} would end their duty at ${fmt(arr)}: ${dutyMins} minutes, over the ${crew.maxDuty}-minute limit. No reserve crew exists in the data.`,
        values: { dutyStart: fmt(crew.dutyStart), projectedArr: fmt(arr), dutyMins, maxDuty: crew.maxDuty, overBy: dutyMins - crew.maxDuty },
      });
      sim.eventIds.push(ie);
      cancel("crew_duty_limit", null, ie,
        `${f.id} ${f.origin}→${f.destination} is cancelled because crew ${crewId} would exceed the duty limit by ${dutyMins - crew.maxDuty} minutes. The aircraft and crew remain at ${f.origin}.`,
        "crew.max_duty", { overBy: dutyMins - crew.maxDuty });
      sims.push(sim); continue;
    }

    sim.actualDep = dep; sim.actualArr = arr; sim.delay = delay;
    sim.status = delay > 0 ? "delayed" : "on_time";
    if (delay > 0) {
      const re = add({
        ...base, type: "flight_rescheduled", time: dep, airport: f.origin, flightId: f.id, tail, crewId,
        prevState: `${fmt(f.dep)}–${fmt(f.arr)}`, newState: `${fmt(dep)}–${fmt(arr)}`, parentId: causeEventId,
        rule: `schedule.binding.${binding}`,
        explanation: `${f.id} ${f.origin}→${f.destination} now departs ${fmt(dep)} and arrives ${fmt(arr)}, ${delay} minutes late, affecting ${f.pax} passengers.`,
        values: { delay, pax: f.pax, actualDep: fmt(dep), actualArr: fmt(arr) },
      });
      sim.eventIds.push(re); flightEvent[f.id] = re;
    }
    ac.loc = f.destination; ac.prev = f.id; ac.prevArr = arr; ac.ready = arr + TAT;
    cp.loc = f.destination; cp.prev = f.id; cp.prevArr = arr; cp.ready = arr + TAT;
    sims.push(sim);
  }

  const flightById = Object.fromEntries(sims.map((s) => [s.flight.id, s]));

  // --- connections
  const connections: ConnectionOutcome[] = net.connections.map((c) => {
    const a = flightById[c.fromFlight], b = flightById[c.toFlight];
    const baselineSlack = b.flight.dep - (a.flight.arr + c.minConnect);
    let status: ConnectionOutcome["status"];
    let slack: number | null = null;
    if (a.status === "cancelled") status = "broken_inbound_cancelled";
    else if (b.status === "cancelled") status = "broken_outbound_cancelled";
    else { slack = b.actualDep! - (a.actualArr! + c.minConnect); status = slack >= 0 ? "made" : "missed"; }
    return { connection: c, status, inboundArr: a.actualArr, outboundDep: b.actualDep, slack, baselineSlack };
  });
  for (const o of connections) {
    const c = o.connection;
    if (o.status === "made") {
      if (o.slack! < o.baselineSlack && o.slack! < 15) {
        add({
          ...base, type: "connection_at_risk", time: o.inboundArr!, airport: c.airport, flightId: c.toFlight, connectionId: c.id,
          prevState: `slack ${o.baselineSlack}m`, newState: `slack ${o.slack}m`, parentId: flightEvent[c.fromFlight] ?? flightEvent[c.toFlight] ?? null,
          rule: "connection.min_connect",
          explanation: `${c.passengers} passengers connecting ${c.fromFlight} → ${c.toFlight} at ${c.airport} still make it, with only ${o.slack} minutes to spare beyond the ${c.minConnect}-minute minimum.`,
          values: { passengers: c.passengers, slack: o.slack, minConnect: c.minConnect },
        });
      }
      continue;
    }
    const parent = o.status === "broken_inbound_cancelled" ? flightEvent[c.fromFlight]
      : o.status === "broken_outbound_cancelled" ? flightEvent[c.toFlight]
      : flightEvent[c.fromFlight] ?? flightEvent[c.toFlight];
    const explanation = o.status === "missed"
      ? `${c.passengers} passengers miss their connection at ${c.airport}: ${c.fromFlight} lands ${fmt(o.inboundArr)}, they need ${c.minConnect} minutes (until ${fmt(o.inboundArr! + c.minConnect)}), but ${c.toFlight} leaves at ${fmt(o.outboundDep)}.`
      : o.status === "broken_inbound_cancelled"
        ? `${c.passengers} passengers lose their connection at ${c.airport} because their first flight ${c.fromFlight} is cancelled.`
        : `${c.passengers} passengers lose their connection at ${c.airport} because onward flight ${c.toFlight} is cancelled.`;
    add({
      ...base, type: "connection_missed", time: o.outboundDep ?? o.inboundArr ?? net.flightById[c.toFlight].dep, airport: c.airport,
      flightId: c.toFlight, connectionId: c.id, prevState: "connection_feasible", newState: o.status, parentId: parent ?? null,
      rule: "connection.min_connect", explanation,
      values: { passengers: c.passengers, minConnect: c.minConnect, inboundArr: fmt(o.inboundArr), outboundDep: fmt(o.outboundDep), slack: o.slack },
    });
  }

  if (scenario) {
    add({
      ...base, type: "closure_end", time: scenario.end, airport: scenario.airport, parentId: closureStartId,
      prevState: "closed", newState: "open", rule: "closure.reopen",
      explanation: `${net.airportById[scenario.airport].city} (${scenario.airport}) reopens at ${fmt(scenario.end)}.`,
      values: { end: fmt(scenario.end) },
    });
  }

  // root causes
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  for (const s of sims) {
    let id: string | null = s.eventIds[s.eventIds.length - 1] ?? null;
    const seen = new Set<string>();
    while (id && byId[id]?.parentId && !seen.has(id)) { seen.add(id); id = byId[id].parentId; }
    s.rootEventId = id;
  }

  // --- crew duty records
  const crewDuty: CrewDutyRecord[] = net.crews.map((c) => {
    const mine = sims.filter((s) => s.crewId === c.id);
    const op = mine.filter((s) => s.status !== "cancelled");
    const dutyEnd = op.length ? Math.max(...op.map((s) => s.actualArr!)) : null;
    const dutyMins = dutyEnd === null ? 0 : dutyEnd - c.dutyStart;
    return {
      crewId: c.id, dutyStart: c.dutyStart, dutyEnd, dutyMins, maxDuty: c.maxDuty, legal: dutyMins <= c.maxDuty,
      flightsCancelledForDuty: mine.filter((s) => s.cancelReason === "crew_duty_limit").map((s) => s.flight.id),
    };
  });

  // --- capacity monitoring (combined arrivals + departures per clock hour)
  const cap: Record<string, number> = {};
  for (const s of sims) {
    if (s.status === "cancelled") continue;
    const k1 = `${s.flight.origin}|${Math.floor(s.actualDep! / 60)}`;
    const k2 = `${s.flight.destination}|${Math.floor(s.actualArr! / 60)}`;
    cap[k1] = (cap[k1] ?? 0) + 1; cap[k2] = (cap[k2] ?? 0) + 1;
  }
  const capacity: CapacityRecord[] = Object.entries(cap)
    .map(([k, movements]) => { const [airport, h] = k.split("|"); return { airport, hour: Number(h), movements, capacity: net.airportById[airport].capacityPerHour }; })
    .sort((a, b) => a.airport.localeCompare(b.airport) || a.hour - b.hour);

  const kpis = computeKpis(sims, connections, crewDuty, capacity, actions, net);
  const result: SimulationResult = {
    scenario, actions, flights: sims, flightById, connections, crewDuty, capacity, events, kpis, violations: [],
  };
  result.violations = checkInvariants(net, result);
  return result;
}

export function computeKpis(
  sims: SimulatedFlight[], connections: ConnectionOutcome[], crewDuty: CrewDutyRecord[],
  capacity: CapacityRecord[], actions: RecoveryAction[], net: Network,
): Kpis {
  const cancelled = sims.filter((s) => s.status === "cancelled");
  const delayed = sims.filter((s) => s.status === "delayed");
  const missed = connections.filter((c) => c.status !== "made");
  const timingMissed = connections.filter((c) => c.status === "missed");
  const airports = new Set<string>();
  for (const s of [...cancelled, ...delayed]) { airports.add(s.flight.origin); airports.add(s.flight.destination); }
  const cancelledPax = cancelled.reduce((a, s) => a + s.flight.pax, 0);
  const timingMissedPax = timingMissed.reduce((a, c) => a + c.connection.passengers, 0);
  return {
    flightsAffected: cancelled.length + delayed.length,
    delayedFlights: delayed.length,
    cancelledFlights: cancelled.length,
    cancelledPax,
    missedConnectionPax: missed.reduce((a, c) => a + c.connection.passengers, 0),
    missedConnectionGroups: missed.length,
    timingMissedConnectionPax: timingMissedPax,
    delayedPax: delayed.reduce((a, s) => a + s.flight.pax, 0),
    paxDelayMinutes: delayed.reduce((a, s) => a + s.flight.pax * s.delay, 0),
    totalFlightDelay: delayed.reduce((a, s) => a + s.delay, 0),
    maxDelay: delayed.reduce((a, s) => Math.max(a, s.delay), 0),
    crewDutyAlerts: sims.filter((s) => s.cancelReason === "crew_duty_limit").length,
    crewsNearLimit: crewDuty.filter((c) => c.dutyEnd !== null && c.legal && c.maxDuty - c.dutyMins <= 30).length,
    // Proxy: boardings on cancelled flights + connection groups missed purely on timing (both legs flew).
    // Groups broken by a cancellation are already inside the cancelled boardings, so they are not added again.
    strandedProxy: cancelledPax + timingMissedPax,
    airportsImpacted: airports.size,
    capacityExceedances: capacity.filter((c) => c.movements > c.capacity).length,
    interventions: actions.reduce((a, x) => a + (x.kind === "cancel" ? x.flightIds.length : 1), 0),
  };
  void net;
}

/** Independent re-check of every operational rule on a finished result. */
export function checkInvariants(net: Network, r: SimulationResult): string[] {
  const v: string[] = [];
  const TAT = net.minTurnaround;
  const s = r.scenario;
  const byTail: Record<string, SimulatedFlight[]> = {};
  const byCrew: Record<string, SimulatedFlight[]> = {};
  for (const f of r.flights) {
    if (f.status === "cancelled") continue;
    (byTail[f.tail] ??= []).push(f);
    (byCrew[f.crewId] ??= []).push(f);
    if (f.actualDep! < f.flight.dep) v.push(`${f.flight.id} departs before schedule`);
    if (f.actualArr! - f.actualDep! !== f.flight.block) v.push(`${f.flight.id} block time changed`);
    if (s && inClosure(s, f.flight.origin, f.actualDep!)) v.push(`${f.flight.id} departs during closure`);
    if (s && inClosure(s, f.flight.destination, f.actualArr!)) v.push(`${f.flight.id} arrives during closure`);
  }
  for (const [tail, legs] of Object.entries(byTail)) {
    legs.sort((a, b) => a.actualDep! - b.actualDep!);
    const ac = net.aircraftByTail[tail];
    if (legs[0].flight.origin !== ac.base) v.push(`${tail} first leg not from ${ac.base}`);
    if (legs[0].actualDep! < ac.availableFrom) v.push(`${tail} used before available`);
    for (let i = 1; i < legs.length; i++) {
      if (legs[i].flight.origin !== legs[i - 1].flight.destination) v.push(`${tail} teleports before ${legs[i].flight.id}`);
      if (legs[i].actualDep! < legs[i - 1].actualArr! + TAT) v.push(`${tail} turnaround < ${TAT}m before ${legs[i].flight.id}`);
    }
  }
  for (const [crewId, legs] of Object.entries(byCrew)) {
    const c = net.crewById[crewId];
    legs.sort((a, b) => a.actualDep! - b.actualDep!);
    if (legs[0].flight.origin !== c.base) v.push(`${crewId} first leg not from base`);
    for (let i = 1; i < legs.length; i++) {
      if (legs[i].flight.origin !== legs[i - 1].flight.destination) v.push(`${crewId} teleports before ${legs[i].flight.id}`);
      if (legs[i].actualDep! < legs[i - 1].actualArr! + TAT) v.push(`${crewId} connection < ${TAT}m`);
    }
    const end = legs[legs.length - 1].actualArr!;
    if (end - c.dutyStart > c.maxDuty) v.push(`${crewId} exceeds duty`);
  }
  return v;
}

export function eventTypeLabel(t: EventType): string {
  return ({
    closure_start: "Closure begins", closure_end: "Airport reopens", closure_constraint: "Closure constraint",
    flight_rescheduled: "Flight rescheduled", rotation_propagation: "Rotation knock-on", crew_infeasible: "Crew duty limit",
    flight_cancelled: "Flight cancelled", connection_missed: "Connection missed", connection_at_risk: "Connection at risk",
    recovery_assignment: "Recovery action", recovery_evaluation: "Recovery evaluation",
  } as Record<EventType, string>)[t];
}
