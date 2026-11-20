"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Network, SimulationResult, SimulatedFlight } from "@/engine/types";
import { fmt } from "@/engine/time";

export const STATUS_COLOR = { normal: "#65D8EF", delayed: "#F4BA65", cancelled: "#F26E73", improved: "#78E9C4" } as const;

const W = 560, H = 640, PAD = 46;

export function useProjection(net: Network) {
  return useMemo(() => {
    const lats = net.airports.map((a) => a.lat), lngs = net.airports.map((a) => a.lng);
    const k = Math.cos((20 * Math.PI) / 180);
    const minX = Math.min(...lngs) * k, maxX = Math.max(...lngs) * k, minY = Math.min(...lats), maxY = Math.max(...lats);
    const sc = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
    const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
    const pos: Record<string, { x: number; y: number }> = {};
    for (const a of net.airports) pos[a.id] = { x: ox + (a.lng * k - minX) * sc, y: H - (oy + (a.lat - minY) * sc) };
    return pos;
  }, [net]);
}

function ctrl(p: { x: number; y: number }, q: { x: number; y: number }) {
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, dx = q.x - p.x, dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(60, len * 0.18);
  return { x: mx + (-dy / len) * bend, y: my + (dx / len) * bend };
}
function bez(p: { x: number; y: number }, c: { x: number; y: number }, q: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return { x: u * u * p.x + 2 * u * t * c.x + t * t * q.x, y: u * u * p.y + 2 * u * t * c.y + t * t * q.y };
}

const rank = { normal: 0, improved: 1, delayed: 2, cancelled: 3 } as const;
export function flightTone(f: SimulatedFlight, compare?: SimulationResult | null): keyof typeof STATUS_COLOR {
  if (compare) {
    const b = compare.flightById[f.flight.id];
    const worse = (x: SimulatedFlight) => (x.status === "cancelled" ? 10000 : x.delay);
    if (b && worse(f) < worse(b)) return "improved";
  }
  return f.status === "cancelled" ? "cancelled" : f.status === "delayed" ? "delayed" : "normal";
}

export function NetworkMap(props: {
  net: Network;
  result: SimulationResult;
  compare?: SimulationResult | null;
  time: number;
  selectedFlight?: string | null;
  highlightFlights?: string[];
  highlightAirports?: string[];
  onSelectFlight?: (id: string) => void;
  showPlanes?: boolean;
  revealKey?: string | number;
}) {
  const { net, result, compare, time, selectedFlight, onSelectFlight } = props;
  const pos = useProjection(net);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const s = result.scenario;
  const hiF = new Set(props.highlightFlights ?? []);
  const hiA = new Set(props.highlightAirports ?? []);
  const focus = selectedFlight ? new Set([selectedFlight]) : hiF.size ? hiF : null;

  // Directed routes deduplicated per undirected pair; each keeps its underlying flight records.
  const routes = useMemo(() => {
    const m = new Map<string, SimulatedFlight[]>();
    for (const f of result.flights) {
      const key = [f.flight.origin, f.flight.destination].sort().join("-");
      (m.get(key) ?? m.set(key, []).get(key)!).push(f);
    }
    return [...m.entries()].map(([key, flights]) => {
      const [a, b] = key.split("-");
      const tone = flights.map((f) => flightTone(f, compare)).sort((x, y) => rank[y] - rank[x])[0];
      return { key, a, b, flights, tone };
    });
  }, [result, compare]);

  useEffect(() => {
    if (!svgRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(".ap-node", { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.5, stagger: 0.035, ease: "back.out(2)" });
      gsap.fromTo(".route", { strokeDashoffset: 400, strokeDasharray: 400 }, { strokeDashoffset: 0, duration: 1.1, stagger: 0.02, ease: "power2.out", clearProps: "strokeDasharray,strokeDashoffset" });
    }, svgRef);
    return () => ctx.revert();
  }, [props.revealKey]);

  const airborne = props.showPlanes === false ? [] : result.flights.filter((f) => f.status !== "cancelled" && f.actualDep! <= time && time < f.actualArr!);
  const hovered = hover ? result.flightById[hover] : null;

  return (
    <div className="relative h-full w-full">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Network map of the 16 dataset airports and their scheduled routes">
        <defs>
          <radialGradient id="glow"><stop offset="0%" stopColor="#65D8EF" stopOpacity=".18" /><stop offset="100%" stopColor="#65D8EF" stopOpacity="0" /></radialGradient>
        </defs>
        {/* graticule: purely decorative reference grid */}
        {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} x1={40 + i * 60} x2={40 + i * 60} y1={10} y2={H - 10} stroke="#12243a" strokeWidth={1} />)}
        {Array.from({ length: 10 }, (_, i) => <line key={`h${i}`} y1={20 + i * 66} y2={20 + i * 66} x1={10} x2={W - 10} stroke="#12243a" strokeWidth={1} />)}

        {routes.map((r) => {
          const p = pos[r.a], q = pos[r.b], c = ctrl(p, q);
          const isFocus = focus ? r.flights.some((f) => focus.has(f.flight.id)) : true;
          const col = STATUS_COLOR[r.tone];
          return (
            <g key={r.key}>
              <path className="route" d={`M${p.x},${p.y} Q${c.x},${c.y} ${q.x},${q.y}`} fill="none" stroke={col}
                strokeWidth={isFocus && focus ? 3 : r.tone === "normal" ? 1.2 : 2}
                strokeOpacity={focus ? (isFocus ? 1 : 0.12) : r.tone === "normal" ? 0.35 : 0.9}
                strokeDasharray={r.tone === "cancelled" ? "5 5" : undefined} style={{ transition: "stroke .5s, stroke-opacity .4s" }} />
              <path d={`M${p.x},${p.y} Q${c.x},${c.y} ${q.x},${q.y}`} fill="none" stroke="transparent" strokeWidth={12}
                className="cursor-pointer" onMouseEnter={() => setHover(r.flights[0].flight.id)} onMouseLeave={() => setHover(null)}
                onClick={() => onSelectFlight?.(r.flights.slice().sort((x, y) => rank[flightTone(y, compare)] - rank[flightTone(x, compare)])[0].flight.id)}>
                <title>{r.flights.map((f) => `${f.flight.id} ${f.flight.origin}→${f.flight.destination} ${f.status}`).join("\n")}</title>
              </path>
            </g>
          );
        })}

        {airborne.map((f) => {
          const p = pos[f.flight.origin], q = pos[f.flight.destination], c = ctrl(pos[[f.flight.origin, f.flight.destination].sort()[0]], pos[[f.flight.origin, f.flight.destination].sort()[1]]);
          const sorted = [f.flight.origin, f.flight.destination].sort();
          const forward = sorted[0] === f.flight.origin;
          const t = (time - f.actualDep!) / (f.actualArr! - f.actualDep!);
          const pt = bez(forward ? p : q, c, forward ? q : p, forward ? t : 1 - t);
          const tone = flightTone(f, compare);
          return (
            <g key={f.flight.id} className="cursor-pointer" onClick={() => onSelectFlight?.(f.flight.id)}>
              <circle cx={pt.x} cy={pt.y} r={9} fill={STATUS_COLOR[tone]} opacity={0.18} />
              <circle cx={pt.x} cy={pt.y} r={3.6} fill={STATUS_COLOR[tone]} stroke="#08121F" strokeWidth={1.2} />
              <title>{`${f.flight.id} airborne ${fmt(f.actualDep)}→${fmt(f.actualArr)}`}</title>
            </g>
          );
        })}

        {net.airports.map((a) => {
          const p = pos[a.id];
          const closed = s && s.airport === a.id;
          const closedNow = closed && time >= s!.start && time < s!.end;
          const r = a.tier === "mega_hub" ? 7 : a.tier === "regional_hub" ? 5.5 : 4.2;
          const lit = hiA.has(a.id);
          return (
            <g key={a.id} className="ap-node" style={{ transformBox: "fill-box" }}>
              {closed && <circle cx={p.x} cy={p.y} r={30} fill="url(#glow)" />}
              {closedNow && <circle className="closure-ring" cx={p.x} cy={p.y} r={8} fill="none" stroke="#F26E73" strokeWidth={2} />}
              {lit && <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke="#F4F8FC" strokeOpacity={0.6} strokeWidth={1.2} />}
              <circle cx={p.x} cy={p.y} r={r} fill={closed ? (closedNow ? "#F26E73" : "#3a1b25") : "#0c1a2c"} stroke={closed ? "#F26E73" : "#65D8EF"} strokeWidth={1.6} />
              <text x={p.x + r + 5} y={p.y + 4} fontSize={11} fill="#F4F8FC" className="mono" fontWeight={600}>{a.id}</text>
              <text x={p.x + r + 5} y={p.y + 15} fontSize={8.5} fill="#8aa0b8">{a.city}</text>
              <title>{`${a.name}, ${a.city} · ${a.tier.replace("_", " ")} · capacity ${a.capacityPerHour}/h`}</title>
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-line bg-night/95 px-3 py-2 text-xs">
          <div className="mono font-semibold">{hovered.flight.id} · {hovered.flight.origin}→{hovered.flight.destination}</div>
          <div className="text-mute">Sched {fmt(hovered.flight.dep)}–{fmt(hovered.flight.arr)} · {hovered.status === "cancelled" ? "Cancelled" : `Actual ${fmt(hovered.actualDep)}–${fmt(hovered.actualArr)}`}</div>
        </div>
      )}
    </div>
  );
}
