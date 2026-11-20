"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, X } from "lucide-react";
import { explainFlight } from "@/engine/explain";
import { eventTypeLabel } from "@/engine/simulate";
import { fmt } from "@/engine/time";
import type { Network, SimulationResult } from "@/engine/types";
import { useUi } from "@/lib/store";
import { STATUS_COLOR, flightTone } from "./NetworkMap";
import { JourneyLab } from "./JourneyLab";

const BINDING_LABEL: Record<string, string> = {
  schedule: "Scheduled time (no constraint)", aircraft_rotation: "Late inbound aircraft + 30-min turnaround",
  crew_connection: "Late crew + 30-min connection", spare_availability: "Spare availability",
  closure_departure: "Origin airport closed", closure_arrival_hold: "Destination closed → ground hold",
  connection_hold: "Dispatcher hold for connecting passengers",
};

export function FlightDrawer({ net, result, compare, inline }: { net: Network; result: SimulationResult; compare: SimulationResult | null; inline?: boolean }) {
  const { selectedFlight, set, tab } = useUi();
  const [layer, setLayer] = useState<1 | 2 | 3>(1);
  const sim = selectedFlight ? result.flightById[selectedFlight] : null;
  if (inline) {
    if (!sim) return <div className="flex h-full items-center justify-center p-8 text-center text-[15px] text-mute">Select a flight on the map, timeline or list to investigate it.</div>;
    return <div className="flex h-full flex-col overflow-hidden"><Body net={net} result={result} compare={compare} fid={sim.flight.id} layer={layer} setLayer={setLayer} onClose={() => set({ selectedFlight: null })} /></div>;
  }
  return (
    <AnimatePresence>
      {sim && tab !== "brief" && (
        <motion.aside key="drawer" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.22 }}
          className="panel absolute inset-0 z-30 flex flex-col overflow-hidden bg-night-2" role="dialog" aria-label={`Flight DNA for ${sim.flight.id}`}>
          <Body net={net} result={result} compare={compare} fid={sim.flight.id} layer={layer} setLayer={setLayer} onClose={() => set({ selectedFlight: null })} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Body({ net, result, compare, fid, layer, setLayer, onClose }: { net: Network; result: SimulationResult; compare: SimulationResult | null; fid: string; layer: 1 | 2 | 3; setLayer: (l: 1 | 2 | 3) => void; onClose: () => void }) {
  const set = useUi((s) => s.set);
  const sim = result.flightById[fid];
  const f = sim.flight;
  const x = explainFlight(net, result, fid);
  const tone = flightTone(sim, compare);
  const crew = result.crewDuty.find((c) => c.crewId === sim.crewId)!;
  const before = compare?.flightById[fid];
  return (
    <>
      <div className="flex items-start gap-3 border-b border-line p-4">
        <div className="flex-1">
          <div className="label">Flight DNA</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="mono text-2xl font-semibold">{f.id}</span>
            <span className="rounded px-1.5 py-0.5 text-[11px] font-bold uppercase" style={{ background: STATUS_COLOR[tone], color: "#08121F" }}>
              {tone === "improved" ? "improved" : sim.status.replace("_", " ")}
            </span>
          </div>
          <div className="mt-1 text-sm text-mute">{net.airportById[f.origin].city} <ArrowRight className="inline" size={12} /> {net.airportById[f.destination].city} · aircraft <span className="mono text-ice">{sim.tail}</span>{sim.tail !== f.tail && <> (planned {f.tail})</>} · crew <span className="mono text-ice">{sim.crewId}</span></div>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close flight panel"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line text-sm">
        <Cell k="Scheduled" v={`${fmt(f.dep)} → ${fmt(f.arr)}`} />
        <Cell k="Simulated" v={sim.status === "cancelled" ? "Not operated" : `${fmt(sim.actualDep)} → ${fmt(sim.actualArr)}`} accent={sim.status === "cancelled" ? STATUS_COLOR.cancelled : sim.delay ? STATUS_COLOR.delayed : undefined} />
        <Cell k="Delay" v={sim.status === "cancelled" ? "—" : `${sim.delay} min`} />
        <Cell k="Passengers" v={`${f.pax} booked`} />
        <Cell k="Binding constraint" v={sim.status === "cancelled" ? (sim.cancelReason ?? "").replace(/_/g, " ") : BINDING_LABEL[sim.evidence!.binding]} wide />
        <Cell k="Crew duty" v={crew.dutyEnd === null ? "No flights operated" : `${crew.dutyMins} / ${crew.maxDuty} min (${crew.maxDuty - crew.dutyMins} left)`} wide accent={crew.flightsCancelledForDuty.length ? STATUS_COLOR.cancelled : undefined} />
        {before && before.status !== sim.status || (before && before.delay !== sim.delay) ? (
          <Cell k="Before recovery" v={before!.status === "cancelled" ? "Cancelled" : `${fmt(before!.actualDep)} (+${before!.delay} min)`} wide />
        ) : null}
      </div>

      <div className="px-4 pt-3">
        <div className="label mb-2">Reasoning Lens</div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-night p-1 text-xs font-semibold" role="tablist">
          {(["What happened?", "Why did it happen?", "Show the proof"] as const).map((t, i) => (
            <button key={t} role="tab" aria-selected={layer === i + 1} onClick={() => setLayer((i + 1) as 1 | 2 | 3)}
              className={`rounded-md px-2 py-1.5 ${layer === i + 1 ? "bg-night-3 text-radar" : "text-mute hover:text-ice"}`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-4 text-sm leading-relaxed">
        {layer === 1 && (
          <div className="space-y-3">
            <p className="text-[15px]">{x.what}</p>
            <JourneyLab sim={sim} />
            {x.connections.length > 0 && (
              <div className="space-y-1.5">
                <div className="label">Passenger connections</div>
                {x.connections.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-xs">
                    <span><span className="mono">{c.id}</span> · {c.passengers} pax {c.role === "inbound" ? `onward to ${c.other}` : `arriving from ${c.other}`}</span>
                    <span style={{ color: c.status === "made" ? STATUS_COLOR.improved : STATUS_COLOR.cancelled }}>{c.status === "made" ? `made (${c.slack} min spare)` : c.status === "missed" ? `missed by ${-c.slack!} min` : c.status.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            )}
            {x.consequences.length > 0 && (
              <div className="space-y-1.5">
                <div className="label">What this flight caused next</div>
                {x.consequences.map((e) => (
                  <button key={e.id} onClick={() => e.flightId && set({ selectedFlight: e.flightId, time: e.time })} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-xs hover:border-radar">
                    <span className="mono text-mute">{e.id}</span> · {e.explanation}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {layer === 2 && (
          <div>
            {x.chain.length === 0 ? <p className="text-mute">No upstream cause: this flight operates exactly as scheduled.</p> : (
              <ol className="relative space-y-3 border-l border-line pl-5">
                {x.chain.map((e, i) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2" style={{ borderColor: i === x.chain.length - 1 ? STATUS_COLOR[tone] : "#65D8EF", background: "#08121F" }} />
                    <div className="flex items-center gap-2 text-[11px]"><span className="mono text-mute">{e.id}</span><span className="chip">{eventTypeLabel(e.type)}</span><span className="mono text-radar">{fmt(e.time)}</span></div>
                    <button className="mt-1 text-left hover:text-radar" onClick={() => e.flightId && e.flightId !== fid && set({ selectedFlight: e.flightId, time: e.time })}>{e.explanation}</button>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-4 text-xs text-mute">Each step is a recorded engine event. The chain follows parent links back to the earliest recorded cause.</p>
          </div>
        )}
        {layer === 3 && (
          <div className="space-y-3">
            {sim.evidence ? (
              <>
                <div className="label">Engine calculation</div>
                <ol className="mono space-y-1.5 rounded-lg bg-night p-3 text-[11.5px] text-ice/90">
                  {sim.evidence.formulas.map((l, i) => <li key={i}>{l}</li>)}
                </ol>
                <table className="mono w-full text-[11.5px]"><tbody>
                  <Row k="scheduled_dep" v={fmt(sim.evidence.scheduledDep)} />
                  <Row k="aircraft_ready" v={`${fmt(sim.evidence.aircraftReady.value)} (${sim.evidence.aircraftReady.source}${sim.evidence.aircraftReady.prevFlight ? `: ${sim.evidence.aircraftReady.prevFlight}` : ""})`} />
                  <Row k="crew_ready" v={`${fmt(sim.evidence.crewReady.value)} (${sim.evidence.crewReady.crewId})`} />
                  <Row k="binding" v={sim.evidence.binding} />
                  <Row k="min_turnaround" v={`${net.minTurnaround} min`} />
                  <Row k="block_minutes" v={`${f.block}`} />
                  {sim.evidence.crewDuty && <Row k="crew_duty" v={`${sim.evidence.crewDuty.dutyMins} / ${sim.evidence.crewDuty.maxDuty} → ${sim.evidence.crewDuty.legal ? "legal" : "illegal"}`} />}
                </tbody></table>
              </>
            ) : <p className="text-mute">This flight was not timed: it was removed before departure ({sim.cancelReason?.replace(/_/g, " ")}{sim.cancelCauseFlight ? `, caused by ${sim.cancelCauseFlight}` : ""}).</p>}
            <div className="label pt-2">Event records</div>
            {sim.eventIds.length ? sim.eventIds.map((id) => {
              const e = result.events.find((z) => z.id === id)!;
              return <pre key={id} className="mono overflow-x-auto rounded-lg bg-night p-2 text-[10.5px] text-mute">{JSON.stringify({ id: e.id, type: e.type, rule: e.rule, time: fmt(e.time), prev: e.prevState, next: e.newState, parent: e.parentId, values: e.values }, null, 1)}</pre>;
            }) : <p className="text-xs text-mute">No events — the flight is unaffected.</p>}
          </div>
        )}
      </div>
    </>
  );
}

function Cell({ k, v, accent, wide }: { k: string; v: string; accent?: string; wide?: boolean }) {
  return <div className={`bg-night-2 px-4 py-2 ${wide ? "col-span-2" : ""}`}><div className="label">{k}</div><div className="mono mt-0.5" style={{ color: accent }}>{v}</div></div>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <tr className="border-b border-line/50"><td className="py-1 pr-3 text-mute">{k}</td><td className="py-1">{v}</td></tr>;
}
