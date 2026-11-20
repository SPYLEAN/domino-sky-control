"use client";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { fmt } from "@/engine/time";
import type { SimulatedFlight } from "@/engine/types";

/**
 * AIRCRAFT JOURNEY LAB — a 2.5D, data-bound turnaround explainer.
 * Every marker is read from the flight's CauseEvidence; nothing is animated that the engine did not compute.
 */
export function JourneyLab({ sim }: { sim: SimulatedFlight }) {
  const ref = useRef<HTMLDivElement>(null);
  const e = sim.evidence;
  const prev = e?.aircraftReady.prevFlight ?? null;
  const prevArr = e?.aircraftReady.prevArr ?? null;
  const tat = e?.aircraftReady.turnaround ?? 30;
  const ready = e?.aircraftReady.value ?? null;
  const sched = sim.flight.dep;
  const dep = sim.actualDep;
  const W = 520;
  const t0 = Math.min(prevArr ?? sched, sched) - 15;
  const t1 = Math.max(dep ?? sched, sched, ready ?? 0) + 15;
  const x = (t: number) => 20 + ((t - t0) / (t1 - t0)) * (W - 40);

  useEffect(() => {
    if (!ref.current || !e || sim.status === "cancelled" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
      if (prevArr !== null) tl.fromTo(".jl-plane", { x: -60 }, { x: 0, duration: 0.9 });
      tl.fromTo(".jl-tat", { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.9 });
      tl.to(".jl-plane", { x: x(dep!) - x(prevArr ?? t0 + 15), duration: 1.1 }, "+=0.2");
      const safety = setTimeout(() => tl.progress(1), 4000);
      return () => clearTimeout(safety);
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim.flight.id, dep]);

  if (sim.status === "cancelled" || !e) {
    return (
      <div className="rounded-xl bg-night p-4 text-[13px] text-mute">
        <div className="label mb-1">Aircraft Journey Lab</div>
        {sim.flight.id} was not operated ({sim.cancelReason?.replace(/_/g, " ")}), so no departure is shown.
      </div>
    );
  }
  const gateX = x(prevArr ?? t0 + 15);
  return (
    <div ref={ref} className="rounded-xl bg-night p-4">
      <div className="label mb-2">Aircraft Journey Lab · {sim.tail}</div>
      <div style={{ perspective: 700 }}>
        <svg viewBox={`0 0 ${W} 150`} className="w-full" style={{ transform: "rotateX(18deg)", transformOrigin: "50% 100%" }} role="img"
          aria-label={`${prev ? `Aircraft ${sim.tail} arrived on ${prev} at ${fmt(prevArr)}, needed ${tat} minutes, ready ${fmt(ready)}. ` : ""}Scheduled ${fmt(sched)}, departed ${fmt(dep)}.`}>
          <rect x={10} y={70} width={W - 20} height={46} rx={8} fill="#0c1a2c" stroke="#1c3350" />
          {Array.from({ length: 12 }, (_, i) => <line key={i} x1={20 + i * 42} x2={36 + i * 42} y1={93} y2={93} stroke="#2a4466" strokeWidth={2} />)}
          {prevArr !== null && <rect className="jl-tat" x={x(prevArr)} y={118} width={Math.max(2, x(prevArr + tat) - x(prevArr))} height={6} rx={3} fill="#65D8EF" />}
          {dep! > sched && <rect x={x(sched)} y={127} width={x(dep!) - x(sched)} height={6} rx={3} fill="#F4BA65" />}
          {[
            ...(prevArr !== null ? [{ t: prevArr, l: `${prev} lands ${fmt(prevArr)}`, c: "#F4F8FC", y: 20 }] : []),
            ...(ready !== null && prev ? [{ t: ready, l: `ready ${fmt(ready)}`, c: "#65D8EF", y: 38 }] : []),
            { t: sched, l: `sched ${fmt(sched)}`, c: "#8aa0b8", y: 56 },
            { t: dep!, l: `departs ${fmt(dep)}`, c: dep! > sched ? "#F4BA65" : "#78E9C4", y: 20 },
          ].map((m, i) => (
            <g key={i}>
              <line x1={x(m.t)} x2={x(m.t)} y1={m.y + 4} y2={116} stroke={m.c} strokeOpacity={0.5} strokeDasharray="2 3" />
              <text x={x(m.t)} y={m.y} fontSize={10.5} fill={m.c} textAnchor={x(m.t) > W - 90 ? "end" : x(m.t) < 90 ? "start" : "middle"} className="mono">{m.l}</text>
            </g>
          ))}
          <g className="jl-plane" transform={`translate(${gateX - 16}, 84)`}>
            <path d="M0 9 L22 7 L30 0 L34 0 L30 7 L40 8 Q44 9 40 10 L30 11 L34 18 L30 18 L22 11 L0 10 Z" fill="#F4F8FC" />
          </g>
        </svg>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-ice/85">
        {prev
          ? <>This aircraft arrived on <span className="mono">{prev}</span> at <span className="mono">{fmt(prevArr)}</span>. It required <span className="mono">{tat}</span> minutes on the ground, so it could not leave before <span className="mono">{fmt(ready)}</span>. {e.binding === "aircraft_rotation" ? <>Because that arrival was late, {sim.flight.id} could not leave on schedule at <span className="mono">{fmt(sched)}</span>; it departed <span className="mono text-amber">{fmt(dep)}</span>.</> : <>The binding constraint here was <span className="mono">{e.binding.replace(/_/g, " ")}</span>, not the aircraft; it departed <span className="mono">{fmt(dep)}</span>.</>}</>
          : <>This is {sim.tail}&apos;s first flight of the day, so there is no inbound aircraft dependency. Binding constraint: <span className="mono">{e.binding.replace(/_/g, " ")}</span>; departed <span className="mono">{fmt(dep)}</span>.</>}
      </p>
      <div className="mt-1 flex gap-3 text-[11px] text-mute"><span><span className="inline-block h-1.5 w-3 rounded bg-radar" /> min turnaround</span><span><span className="inline-block h-1.5 w-3 rounded bg-amber" /> delay vs schedule</span></div>
    </div>
  );
}
