"use client";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { fmt } from "@/engine/time";
import type { Sim } from "@/lib/useSim";
import { useUi } from "@/lib/store";

export function Intro({ sim }: { sim: Sim }) {
  const set = useUi((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const r = sim.disrupted;
  const s = sim.scenario;
  const ap = sim.net.airportById[s.airport];
  const first = r.events.filter((e) => e.type === "closure_constraint").sort((a, b) => a.time - b.time)[0];
  const firstSim = first ? r.flightById[first.flightId!] : null;
  const prop = r.events.filter((e) => e.type === "rotation_propagation").sort((a, b) => a.time - b.time)[0];
  const propSim = prop ? r.flightById[prop.flightId!] : null;
  const k = r.kpis;
  const lines: [string, string][] = [
    ["One airport closes.", `${ap.city} · ${fmt(s.start)}–${fmt(s.end)}`],
    ["One aircraft arrives late.", firstSim ? `${firstSim.flight.id} on ${firstSim.tail} · +${firstSim.delay} min` : "No flight is directly hit in this scenario"],
    ["Its next flight cannot depart.", propSim ? `${propSim.flight.id} waits for ${propSim.tail} · leaves ${fmt(propSim.actualDep)}` : "No knock-on delay in this scenario"],
    ["Passengers miss connections.", k.missedConnectionGroups ? `${k.missedConnectionPax} passengers in ${k.missedConnectionGroups} groups` : "Every connection still holds"],
    ["Crews reach their duty limits.", k.crewDutyAlerts ? `${k.crewDutyAlerts} flight${k.crewDutyAlerts > 1 ? "s" : ""} cannot legally fly` : `No limit broken · ${k.crewsNearLimit} crews within 30 min`],
    ["Now recover the network.", `${sim.report.stats.simulated} recovery plans simulated`],
  ];
  useEffect(() => {
    if (!ref.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context(() => {
      if (reduce) return;
      const tl = gsap.timeline(); tl.from(".intro-line", { opacity: 0.25, y: 12, duration: 0.45, stagger: 0.4, ease: "power3.out" });
      tl.fromTo(".intro-domino", { rotate: 0 }, { rotate: 22, duration: 0.3, stagger: 0.4, ease: "power2.in", transformOrigin: "100% 100%" }, 0.15);
      const safety = setTimeout(() => tl.progress(1), 3500);
      return () => clearTimeout(safety);
    }, ref);
    return () => ctx.revert();
  }, []);
  const close = () => { try { localStorage.setItem("ds-intro-seen", "1"); } catch {} set({ introOpen: false }); };
  return (
    <div ref={ref} className="fixed inset-0 z-[60] flex items-center justify-center bg-night/95 p-6 backdrop-blur-sm" role="dialog" aria-label="The Domino Effect introduction">
      <div className="w-full max-w-2xl">
        <div className="label text-radar">The Domino Effect · computed from the live simulation below</div>
        <ol className="mt-6 space-y-3">
          {lines.map(([a, b], i) => (
            <li key={i} className="intro-line flex items-center gap-4">
              <span className="intro-domino mr-2 inline-block h-8 w-3 shrink-0 rounded-sm" style={{ background: i === 5 ? "#78E9C4" : i === 0 ? "#F26E73" : "#F4BA65" }} />
              <span className="font-display text-2xl font-semibold">{a}</span>
              <span className="mono ml-auto text-right text-sm text-mute">{b}</span>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex gap-2">
          <button className="btn btn-primary" onClick={close}>Enter control room</button>
          <button className="btn" onClick={() => { close(); set({ storyOpen: true, storyIndex: 0 }); }}>Watch the Domino Story</button>
        </div>
      </div>
    </div>
  );
}
