import { describe, expect, it } from "vitest";
import raw from "../src/data/flight_network.json";
import { buildNetwork, getNetwork } from "../src/engine/data";
import { simulate, validateActions, validateScenario } from "../src/engine/simulate";
import { kpiDelta, runRecovery } from "../src/engine/recovery";
import { sanitizeAiResponse } from "../src/engine/ai-guard";
import { buildStory } from "../src/engine/story";
import type { DisruptionScenario } from "../src/engine/types";

const net = getNetwork();
const sc = (airport: string, s: string, e: string): DisruptionScenario => {
  const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
  return { airport, start: m(s), end: m(e) };
};
const SCENARIOS: [string, DisruptionScenario][] = [
  ["Mumbai 08:00–09:30", sc("BOM", "08:00", "09:30")],
  ["Bengaluru 12:00–14:00", sc("BLR", "12:00", "14:00")],
  ["Delhi 15:00–16:30", sc("DEL", "15:00", "16:30")],
  ["Kolkata 18:00–19:30", sc("CCU", "18:00", "19:30")],
];

describe("dataset contract", () => {
  it("has the documented entity counts", () => {
    expect(net.airports).toHaveLength(16);
    expect(net.flights).toHaveLength(70);
    expect(net.aircraft.filter((a) => !a.isSpare)).toHaveLength(16);
    expect(net.connections).toHaveLength(21);
    expect(net.crews).toHaveLength(16);
    expect(net.aircraft.filter((a) => a.isSpare).map((a) => `${a.tail}@${a.base}`)).toEqual(["VT-DS17@BLR", "VT-DS18@DEL"]);
  });
  it("has the verified passenger totals", () => {
    expect(net.flights.reduce((s, f) => s + f.pax, 0)).toBe(10394);
    expect(net.connections.reduce((s, c) => s + c.passengers, 0)).toBe(659);
  });
  it("resolves every referenced id (buildNetwork throws on integrity errors)", () => {
    const broken = structuredClone(raw) as { connections: { to_flight: string }[] };
    broken.connections[0].to_flight = "DS9999";
    expect(() => buildNetwork(broken)).toThrow(/unknown flight/);
  });
  it("does not mutate the source JSON", () => {
    const before = JSON.stringify(raw);
    simulate(net, sc("BOM", "08:00", "09:30"));
    runRecovery(net, sc("BOM", "08:00", "09:30"));
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("baseline", () => {
  const b = simulate(net, null);
  it("operates every flight on time with no invariant violations", () => {
    expect(b.flights.every((f) => f.status === "on_time")).toBe(true);
    expect(b.violations).toEqual([]);
    expect(b.events).toHaveLength(0);
  });
  it("crews are legal and connections made", () => {
    expect(b.crewDuty.every((c) => c.legal)).toBe(true);
    expect(b.connections.every((c) => c.status === "made")).toBe(true);
  });
});

describe("scenario validation", () => {
  it("rejects zero-duration, negative and unknown-airport scenarios", () => {
    expect(validateScenario(net, { airport: "BOM", start: 480, end: 480 })).not.toHaveLength(0);
    expect(validateScenario(net, { airport: "BOM", start: 480, end: 400 })).not.toHaveLength(0);
    expect(validateScenario(net, { airport: "XXX", start: 480, end: 570 })).not.toHaveLength(0);
    expect(() => simulate(net, { airport: "BOM", start: 480, end: 480 })).toThrow();
    expect(validateScenario(net, sc("BOM", "08:00", "09:30"))).toEqual([]);
  });
});

describe.each(SCENARIOS)("disruption %s", (_n, s) => {
  const r = simulate(net, s);
  it("respects every operational invariant", () => expect(r.violations).toEqual([]));
  it("keeps all departures and arrivals outside the closure", () => {
    for (const f of r.flights) {
      if (f.status === "cancelled") continue;
      if (f.flight.origin === s.airport) expect(f.actualDep! < s.start || f.actualDep! >= s.end).toBe(true);
      if (f.flight.destination === s.airport) expect(f.actualArr! < s.start || f.actualArr! >= s.end).toBe(true);
    }
  });
  it("never shortens turnaround and never teleports aircraft", () => {
    const byTail: Record<string, typeof r.flights> = {};
    for (const f of r.flights) if (f.status !== "cancelled") (byTail[f.tail] ??= []).push(f);
    for (const legs of Object.values(byTail)) {
      for (let i = 1; i < legs.length; i++) {
        expect(legs[i].flight.origin).toBe(legs[i - 1].flight.destination);
        expect(legs[i].actualDep! - legs[i - 1].actualArr!).toBeGreaterThanOrEqual(30);
      }
    }
  });
  it("computes connections from actual timestamps", () => {
    for (const c of r.connections) {
      if (c.status === "made" || c.status === "missed") {
        const a = r.flightById[c.connection.fromFlight], b = r.flightById[c.connection.toFlight];
        expect(c.status === "made").toBe(b.actualDep! >= a.actualArr! + c.connection.minConnect);
      }
    }
  });
  it("never operates an illegal crew duty", () => expect(r.crewDuty.every((c) => c.legal)).toBe(true));
  it("does not count cancelled flights as delayed", () => {
    for (const f of r.flights) if (f.status === "cancelled") { expect(f.delay).toBe(0); expect(f.actualDep).toBeNull(); }
    expect(r.kpis.flightsAffected).toBe(r.kpis.delayedFlights + r.kpis.cancelledFlights);
  });
  it("is deterministic", () => expect(JSON.stringify(simulate(net, s))).toBe(JSON.stringify(r)));
  it("every non-root event has a valid parent", () => {
    const ids = new Set(r.events.map((e) => e.id));
    for (const e of r.events) if (e.parentId) expect(ids.has(e.parentId)).toBe(true);
  });
});

describe("propagation", () => {
  const r = simulate(net, sc("BOM", "08:00", "09:30"));
  it("delays flow down an aircraft's later legs", () => {
    const d0 = r.flightById["DS0501"];
    expect(d0.delay).toBeGreaterThan(0); // BOM departure 08:15 falls in closure
    expect(d0.evidence!.binding).toBe("closure_departure");
    const d1 = r.flightById["DS0502"];
    if (d1.delay > 0) {
      expect(d1.evidence!.binding).toBe("aircraft_rotation");
      expect(d1.actualDep).toBe(d0.actualArr! + 30);
    }
  });
  it("ground-holds inbound arrivals at origin rather than mid-air", () => {
    const f = r.flightById["DS0201"]; // DEL→BOM sched arr 08:10
    expect(f.evidence!.binding).toBe("closure_arrival_hold");
    expect(f.actualArr).toBe(570);
  });
  it("classifies crew overruns as cancellations", () => {
    const k = simulate(net, sc("HYD", "11:00", "13:00"));
    for (const f of k.flights.filter((x) => x.cancelReason === "crew_duty_limit")) {
      expect(f.evidence!.crewDuty!.legal).toBe(false);
    }
    expect(k.crewDuty.every((c) => c.legal)).toBe(true);
  });
});

describe("spare aircraft rules", () => {
  it("cannot be used from the wrong airport", () => {
    const p = validateActions(net, [{ kind: "spare", spareTail: "VT-DS17", originalTail: "VT-DS01", flightIds: ["DS0105"], crewId: "CR01", form: "takeover" }]);
    expect(p.join(" ")).toMatch(/physically at BLR/);
  });
  it("cannot be committed to overlapping operations", () => {
    const a = { kind: "spare" as const, spareTail: "VT-DS17", originalTail: "VT-DS05", flightIds: ["DS0504"], crewId: "CR05", form: "takeover" as const };
    const b = { kind: "spare" as const, spareTail: "VT-DS17", originalTail: "VT-DS14", flightIds: ["DS1404"], crewId: "CR14", form: "takeover" as const };
    expect(validateActions(net, [a, b]).join(" ")).toMatch(/already committed/);
  });
  it("only real dataset spares are accepted", () => {
    expect(validateActions(net, [{ kind: "spare", spareTail: "VT-DS01", originalTail: "VT-DS05", flightIds: ["DS0504"], crewId: "CR05", form: "takeover" }]).length).toBeGreaterThan(0);
  });
});

describe.each(SCENARIOS)("recovery %s", (_n, s) => {
  const rep = runRecovery(net, s);
  it("only ranks feasible plans with clean invariants", () => {
    for (const c of rep.ranked) { expect(c.feasible).toBe(true); expect(c.result!.violations).toEqual([]); }
  });
  it("winner is never worse than doing nothing", () => {
    expect(rep.ranked.indexOf(rep.winner)).toBe(0);
    expect(rep.ranked.some((c) => c.id === "C-NONE")).toBe(true);
  });
  it("fully recalculates the applied plan", () => {
    const fresh = simulate(net, s, rep.winner.actions);
    expect(JSON.stringify(fresh.kpis)).toBe(JSON.stringify(rep.winner.kpis));
  });
  it("before/after differences equal the calculated differences", () => {
    const d = kpiDelta(rep.baseline.kpis, rep.winner.kpis!);
    expect(d.cancelledPax).toBe(rep.winner.kpis!.cancelledPax - rep.baseline.kpis.cancelledPax);
    expect(rep.winner.delta).toEqual(d);
  });
  it("is deterministic", () => {
    const again = runRecovery(net, s);
    expect(again.winner.id).toBe(rep.winner.id);
    expect(again.ranked.map((c) => c.id)).toEqual(rep.ranked.map((c) => c.id));
  });
  it("story chapters reference real event ids", () => {
    const st = buildStory(net, rep.baseline, rep);
    const ids = new Set([...rep.baseline.events.map((e) => e.id), ...(rep.winner.result?.events.map((e) => e.id) ?? [])]);
    expect(st).toHaveLength(7);
    for (const ch of st) for (const id of ch.eventIds) expect(ids.has(id)).toBe(true);
  });
});

describe("AI guard", () => {
  const rep = runRecovery(net, sc("BOM", "08:00", "09:30"));
  const ids = rep.ranked.map((c) => c.id);
  it("rejects unknown candidate ids", () => {
    expect(sanitizeAiResponse({ recommendedCandidateId: "C-INVENTED", headline: "x", rationale: "y", tradeoffs: [] }, ids, net).ok).toBe(false);
  });
  it("rejects responses that inject numbers", () => {
    expect(sanitizeAiResponse({ recommendedCandidateId: ids[0], headline: "Saves 500 passengers", rationale: "ok", tradeoffs: [] }, ids, net).ok).toBe(false);
  });
  it("rejects invented flight ids", () => {
    expect(sanitizeAiResponse({ recommendedCandidateId: ids[0], headline: "Cancel DS7777", rationale: "ok", tradeoffs: [] }, ids, net).ok).toBe(false);
  });
  it("accepts a qualitative response that references real ids only", () => {
    const r = sanitizeAiResponse({ recommendedCandidateId: ids[0], headline: "Protects the Kochi connection", rationale: "Keeps DS0502 flowing.", tradeoffs: ["Some delay remains."] }, ids, net);
    expect(r.ok).toBe(true);
  });
});
