"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ArrowRight, ChevronDown } from "lucide-react";
import { fmt, fmtDur } from "@/engine/time";
import type { SimulationEvent } from "@/engine/types";
import type { Sim } from "@/lib/useSim";
import { useUi } from "@/lib/store";

interface Step { n: string; title: string; text: string; event: SimulationEvent | null; flight: string | null; time: number; proof: string[]; tone: string }

const n = (x: number) => x.toLocaleString("en-IN");

/** First-screen incident summary. Every value is read from the committed simulation result. */
export function IncidentBrief({ sim }: { sim: Sim }) {
  const ui = useUi();
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const r = sim.disrupted;
  const s = sim.scenario;
  const ap = sim.net.airportById[s.airport];
  const k = r.kpis;
  const ev = r.events;
  const closure = ev.find((e) => e.type === "closure_start") ?? null;
  const first = ev.filter((e) => e.type === "closure_constraint").sort((a, b) => a.time - b.time || a.seq - b.seq)[0] ?? null;
  const firstSim = first ? r.flightById[first.flightId!] : null;
  const props = ev.filter((e) => e.type === "rotation_propagation" || (e.type === "flight_cancelled" && e.rule === "aircraft.continuity")).sort((a, b) => a.time - b.time || a.seq - b.seq);
  const sameChain = firstSim ? props.find((e) => r.flightById[e.flightId!].tail === firstSim.tail) : undefined;
  const prop = sameChain ?? props[0] ?? null;
  const otherAircraft = !!prop && !!firstSim && !sameChain;
  const propSim = prop ? r.flightById[prop.flightId!] : null;
  const parent = prop?.parentId ? ev.find((e) => e.id === prop.parentId) : null;
  const human = ev.filter((e) => e.type === "connection_missed" || e.type === "crew_infeasible").sort((a, b) => a.time - b.time || a.seq - b.seq)[0] ?? null;

  const steps: Step[] = [
    {
      n: "01", title: "The closure", tone: "#F26E73", event: closure, flight: null, time: s.start,
      text: `${ap.city} (${ap.id}) is closed ${fmt(s.start)}–${fmt(s.end)} — ${fmtDur(s.end - s.start)} with no take-offs or landings.`,
      proof: closure ? [`${closure.id} · rule ${closure.rule}`, `Blocked when ${fmt(s.start)} ≤ t < ${fmt(s.end)} at ${s.airport}`] : [],
    },
    firstSim && first ? {
      n: "02", title: "The first domino", tone: "#F4BA65", event: first, flight: firstSim.flight.id, time: first.time,
      text: `${firstSim.flight.id} ${firstSim.flight.origin}→${firstSim.flight.destination}: ${first.explanation}`,
      proof: [`${first.id} · rule ${first.rule}`, ...(firstSim.evidence?.formulas ?? [])],
    } : { n: "02", title: "The first domino", tone: "#78E9C4", event: null, flight: null, time: s.start, text: "No scheduled flight touches the closed airport during this window, so nothing is directly constrained.", proof: [] },
    propSim && prop ? {
      n: "03", title: "The cascade", tone: "#F4BA65", event: prop, flight: propSim.flight.id, time: prop.time,
      text: `${otherAircraft ? `The first domino's aircraft absorbed its delay; the first knock-on happens on a different aircraft, ${propSim.tail}. ` : ""}${prop.explanation}${parent?.flightId && parent.flightId !== propSim.flight.id ? ` The cause traces back to ${parent.flightId}.` : ""}`,
      proof: [`${prop.id} · rule ${prop.rule} · parent ${prop.parentId ?? "—"}`, ...(propSim.evidence?.formulas ?? [])],
    } : { n: "03", title: "The cascade", tone: "#78E9C4", event: null, flight: null, time: s.end, text: "No downstream flight was pushed back by a late aircraft: every affected aircraft had enough ground time to absorb the delay.", proof: [] },
    {
      n: "04", title: "Human impact", tone: human ? "#F26E73" : "#78E9C4", event: human, flight: human?.flightId ?? null, time: human?.time ?? s.end,
      text: [
        k.missedConnectionGroups ? `${n(k.missedConnectionPax)} connecting passengers in ${k.missedConnectionGroups} group${k.missedConnectionGroups > 1 ? "s" : ""} miss their onward flight.` : "Every passenger connection still holds.",
        k.cancelledFlights ? `${k.cancelledFlights} flight${k.cancelledFlights > 1 ? "s" : ""} cancelled (${n(k.cancelledPax)} booked boardings).` : "No flight is cancelled.",
        k.crewDutyAlerts ? `${k.crewDutyAlerts} flight${k.crewDutyAlerts > 1 ? "s" : ""} cannot fly because the crew would exceed its legal duty limit.` : "No crew exceeds its duty limit.",
      ].join(" "),
      proof: human ? [`${human.id} · rule ${human.rule}`, human.explanation] : [],
    },
  ];

  useEffect(() => {
    if (!ref.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => { gsap.from(".brief-step", { x: -12, duration: 0.4, stagger: 0.08, ease: "power2.out" }); }, ref);
    return () => ctx.revert();
  }, [ui.scenarioKey]);

  const focus = (st: Step, i: number) => {
    setOpen(open === i ? null : i);
    ui.set({ selectedEvent: st.event?.id ?? null, selectedFlight: st.flight, time: st.time, playing: false });
  };

  return (
    <div ref={ref} className="space-y-4">
      <div>
        <div className="label text-radar">Incident brief · interactive deterministic simulation</div>
        <h2 className="mt-2 font-display text-[26px] font-bold leading-[1.1] tracking-tight">The storm ends.<br /><span className="text-radar">The disruption doesn&apos;t.</span></h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ice/85">
          {ap.city} closed {fmt(s.start)}–{fmt(s.end)}. <span className="mono text-amber">{k.flightsAffected}</span> flights across <span className="mono">{k.airportsImpacted}</span> airports were affected, adding <span className="mono text-amber">{n(k.totalFlightDelay)}</span> minutes of flight delay
          {k.missedConnectionPax ? <>, and <span className="mono text-coral">{n(k.missedConnectionPax)}</span> connecting passengers miss their onward flight.</> : "."}
        </p>
      </div>
      <ol className="space-y-2">
        {steps.map((st, i) => {
          const active = (st.event && ui.selectedEvent === st.event.id) || open === i;
          return (
            <li key={st.n} className="brief-step">
              <button onClick={() => focus(st, i)} aria-expanded={open === i}
                className={`w-full rounded-xl px-4 py-3 text-left transition ${active ? "bg-night-3 ring-1 ring-radar/60" : "bg-night-3/40 hover:bg-night-3/70"}`}>
                <div className="flex items-center gap-3">
                  <span className="mono text-sm font-semibold" style={{ color: st.tone }}>{st.n}</span>
                  <span className="font-display text-[15px] font-semibold">{st.title}</span>
                  {st.flight && <span className="mono ml-auto text-sm text-ice/80">{st.flight}</span>}
                  <ChevronDown size={14} className={`text-mute transition ${open === i ? "rotate-180" : ""} ${st.flight ? "" : "ml-auto"}`} />
                </div>
                {open === i && <p className="mt-2 text-[15px] leading-relaxed text-ice/90">{st.text}</p>}
              </button>
              {open === i && st.proof.length > 0 && (
                <details className="mt-1 rounded-lg bg-night px-3 py-2 text-xs">
                  {st.flight && <button className="float-right text-radar hover:underline" onClick={() => ui.set({ tab: "flights", selectedFlight: st.flight })}>Open Flight DNA →</button>}
                  <summary className="cursor-pointer text-radar">Show the proof</summary>
                  <ol className="mono mt-2 space-y-1 text-[11.5px] text-ice/80">{st.proof.map((l, j) => <li key={j}>{l}</li>)}</ol>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary px-4 py-2.5 text-sm" onClick={() => ui.set({ storyOpen: true, storyIndex: 0 })}>Follow the dominoes <ArrowRight size={14} /></button>
        <button className="btn" onClick={() => ui.set({ tab: "recovery" })}>Compare recovery plans</button>
        <button className="btn" onClick={() => ui.set({ selectedFlight: null, selectedEvent: null, tab: "flights" })}>Explore full network</button>
      </div>
    </div>
  );
}
