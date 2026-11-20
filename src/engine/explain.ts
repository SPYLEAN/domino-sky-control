import { fmt } from "./time";
import type { Network, SimulationEvent, SimulationResult } from "./types";

export interface FlightExplanation {
  what: string;
  chain: SimulationEvent[]; // root → this flight
  consequences: SimulationEvent[]; // events directly caused by this flight
  connections: { id: string; role: "inbound" | "outbound"; status: string; passengers: number; slack: number | null; other: string }[];
}

/** Deterministic plain-language explanation for one flight, built only from engine evidence. */
export function explainFlight(net: Network, r: SimulationResult, flightId: string): FlightExplanation {
  const s = r.flightById[flightId];
  const f = s.flight;
  const ap = (id: string) => net.airportById[id].city;
  const e = s.evidence;
  let what: string;
  if (s.status === "on_time") {
    what = `${f.id} departs ${ap(f.origin)} on schedule at ${fmt(f.dep)} and lands in ${ap(f.destination)} at ${fmt(f.arr)}. Nothing upstream delayed it.`;
  } else if (s.status === "cancelled") {
    const why = s.cancelReason === "crew_duty_limit"
      ? `its crew ${s.crewId} would have finished at ${fmt(e?.crewDuty?.dutyEnd)}, ${e?.crewDuty?.dutyMins} minutes after starting duty at ${fmt(e?.crewDuty?.dutyStart)} — beyond the ${e?.crewDuty?.maxDuty}-minute legal limit. The dataset has no reserve crew, so the flight cannot legally operate`
      : s.cancelReason === "aircraft_out_of_position"
        ? `its aircraft ${s.tail} never reached ${ap(f.origin)} because ${s.cancelCauseFlight ?? "an earlier leg"} was cancelled, and the dataset contains no ferry flights`
        : s.cancelReason === "crew_out_of_position"
          ? `its crew ${s.crewId} never reached ${ap(f.origin)} because ${s.cancelCauseFlight ?? "an earlier leg"} was cancelled`
          : "the recovery plan cancels it deliberately";
    what = `${f.id} was scheduled to depart ${ap(f.origin)} at ${fmt(f.dep)}. It is cancelled because ${why}. ${f.pax} booked passengers lose this flight.`;
  } else {
    const b = e!.binding;
    const base = `${f.id} was scheduled to depart ${ap(f.origin)} at ${fmt(f.dep)}.`;
    if (b === "aircraft_rotation") {
      what = `${base} Its aircraft ${s.tail} was delayed on flight ${e!.aircraftReady.prevFlight}, landing at ${fmt(e!.aircraftReady.prevArr)}. The aircraft could not leave until ${fmt(e!.aircraftReady.prevArr)} plus the ${e!.aircraftReady.turnaround}-minute minimum turnaround. Therefore this flight departed at ${fmt(s.actualDep)}, ${s.delay} minutes late.`;
    } else if (b === "crew_connection") {
      what = `${base} Its crew ${s.crewId} arrived late on ${e!.crewReady.prevFlight} at ${fmt(e!.crewReady.prevArr)} and needed ${e!.crewReady.turnaround} minutes before departing again. Therefore it departed at ${fmt(s.actualDep)}, ${s.delay} minutes late.`;
    } else if (b === "closure_departure") {
      what = `${base} ${ap(f.origin)} airport was closed at that time, so no take-off was allowed until it reopened at ${fmt(r.scenario!.end)}. It departed at ${fmt(s.actualDep)}, ${s.delay} minutes late.`;
    } else if (b === "closure_arrival_hold") {
      what = `${base} Flying on time it would have landed at ${fmt(e!.closureArrivalHold!.projectedArr)}, while ${ap(f.destination)} was closed. Instead of circling in the air, it waited on the ground and departed at ${fmt(s.actualDep)} so it lands exactly at reopening, ${fmt(s.actualArr)}.`;
    } else if (b === "connection_hold") {
      what = `${base} The dispatcher deliberately held it until ${fmt(s.actualDep)} so connecting passengers arriving late could still board. It departs ${s.delay} minutes late.`;
    } else {
      what = `${base} It departed at ${fmt(s.actualDep)}, ${s.delay} minutes late, waiting for spare aircraft ${s.tail} to become available.`;
    }
  }
  const byId = Object.fromEntries(r.events.map((x) => [x.id, x]));
  const chain: SimulationEvent[] = [];
  let id: string | null = s.eventIds[s.eventIds.length - 1] ?? null;
  const seen = new Set<string>();
  while (id && byId[id] && !seen.has(id)) { seen.add(id); chain.unshift(byId[id]); id = byId[id].parentId; }
  const mine = new Set(s.eventIds);
  const consequences = r.events.filter((x) => x.parentId && mine.has(x.parentId) && x.flightId !== flightId);
  const connections = r.connections
    .filter((c) => c.connection.fromFlight === flightId || c.connection.toFlight === flightId)
    .map((c) => ({
      id: c.connection.id, role: (c.connection.fromFlight === flightId ? "inbound" : "outbound") as "inbound" | "outbound",
      status: c.status, passengers: c.connection.passengers, slack: c.slack,
      other: c.connection.fromFlight === flightId ? c.connection.toFlight : c.connection.fromFlight,
    }));
  return { what, chain, consequences, connections };
}

/** Walk any event back to its earliest recorded cause. */
export function traceEvent(r: SimulationResult, eventId: string): SimulationEvent[] {
  const byId = Object.fromEntries(r.events.map((x) => [x.id, x]));
  const out: SimulationEvent[] = [];
  let id: string | null = eventId;
  const seen = new Set<string>();
  while (id && byId[id] && !seen.has(id)) { seen.add(id); out.unshift(byId[id]); id = byId[id].parentId; }
  return out;
}
