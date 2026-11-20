"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { traceEvent } from "@/engine/explain";
import { eventTypeLabel } from "@/engine/simulate";
import { fmt } from "@/engine/time";
import type { EventType, SimulationResult } from "@/engine/types";
import { useUi } from "@/lib/store";

const TYPE_COLOR: Partial<Record<EventType, string>> = {
  closure_start: "#F26E73", closure_end: "#78E9C4", closure_constraint: "#F26E73", flight_rescheduled: "#F4BA65",
  rotation_propagation: "#F4BA65", crew_infeasible: "#F26E73", flight_cancelled: "#F26E73", connection_missed: "#F26E73",
  connection_at_risk: "#F4BA65", recovery_assignment: "#78E9C4",
};

export function EventLedger({ result }: { result: SimulationResult }) {
  const { selectedEvent, set } = useUi();
  const [q, setQ] = useState("");
  const [type, setType] = useState<EventType | "all">("all");
  const [order, setOrder] = useState<"time" | "seq">("time");
  const types = useMemo(() => [...new Set(result.events.map((e) => e.type))], [result]);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return result.events
      .filter((e) => type === "all" || e.type === type)
      .filter((e) => !ql || [e.id, e.flightId, e.tail, e.crewId, e.connectionId, e.airport, e.explanation, e.rule].join(" ").toLowerCase().includes(ql))
      .sort((a, b) => order === "time" ? a.time - b.time || a.seq - b.seq : a.seq - b.seq);
  }, [result, q, type, order]);
  const trace = selectedEvent && result.events.some((e) => e.id === selectedEvent) ? traceEvent(result, selectedEvent) : [];

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-[11px] text-mute">Simulated event ledger — records emitted by the deterministic engine for this what-if scenario. Not real-world telemetry.</p>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-night px-2">
        <Search size={13} className="text-mute" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flight, aircraft, crew, airport…" aria-label="Search events" className="w-full bg-transparent py-1.5 text-xs outline-none" />
      </div>
      <div className="flex flex-wrap gap-1">
        <button className={`chip ${type === "all" ? "border-radar text-radar" : ""}`} onClick={() => setType("all")}>All {result.events.length}</button>
        {types.map((t) => <button key={t} className={`chip ${type === t ? "border-radar text-radar" : ""}`} onClick={() => setType(t)}>{eventTypeLabel(t)} {result.events.filter((e) => e.type === t).length}</button>)}
        <button className="chip ml-auto" onClick={() => setOrder(order === "time" ? "seq" : "time")} title="Operational time vs engine calculation order">Order: {order === "time" ? "operational time" : "engine sequence"}</button>
      </div>
      {trace.length > 1 && (
        <div className="rounded-lg border border-radar/50 bg-night p-2 text-[11px]">
          <div className="label mb-1">Traced to earliest recorded cause</div>
          {trace.map((e, i) => <div key={e.id} className="flex gap-1.5"><span className="mono text-radar">{i === 0 ? "root" : "↳"}</span><span className="mono text-mute">{e.id}</span><span>{eventTypeLabel(e.type)} {e.flightId ?? e.airport}</span></div>)}
        </div>
      )}
      <ol className="scroll-thin flex-1 space-y-1 overflow-y-auto pr-1">
        {list.length === 0 && <li className="text-xs text-mute">No events match.</li>}
        {list.map((e) => (
          <li key={e.id}>
            <button onClick={() => set({ selectedEvent: e.id, selectedFlight: e.flightId, time: e.time, playing: false })}
              className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs transition ${selectedEvent === e.id ? "border-radar bg-radar/5" : "border-line hover:border-radar/50"}`}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[e.type] ?? "#65D8EF" }} />
                <span className="mono text-mute">{e.id}</span>
                <span className="font-semibold">{eventTypeLabel(e.type)}</span>
                <span className="mono ml-auto text-radar">{fmt(e.time)}</span>
              </div>
              <div className="mt-1 leading-snug text-ice/85">{e.explanation}</div>
              <div className="mono mt-1 text-[10px] text-mute">rule {e.rule}{e.parentId ? ` · parent ${e.parentId}` : " · root"}</div>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
