"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Network, SimulationResult, SimulatedFlight } from "@/engine/types";
import { fmt } from "@/engine/time";

export const STATUS_COLOR = { normal: "#65D8EF", delayed: "#F4BA65", cancelled: "#F26E73", improved: "#78E9C4" } as const;

// Fixed SVG coordinate system; the element scales uniformly (preserveAspectRatio meet), so geometry never distorts.
const W = 600, H = 660, PAD = 56;

/** North-up equirectangular projection of the dataset's lat/lng, corrected by cos(20°) for India's mid-latitude. */
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

// Hand-tuned label sides so neighbouring airports (BOM/PNQ, COK/TRV, BLR/MAA, DEL/JAI) never collide.
const LABEL: Record<string, { dx: number; dy: number; anchor: "start" | "end" }> = {
  BOM: { dx: -12, dy: -4, anchor: "end" }, PNQ: { dx: 11, dy: 12, anchor: "start" }, GOI: { dx: -11, dy: 4, anchor: "end" },
  AMD: { dx: -11, dy: 4, anchor: "end" }, JAI: { dx: -11, dy: 4, anchor: "end" }, DEL: { dx: 12, dy: 2, anchor: "start" },
  IXC: { dx: 11, dy: -4, anchor: "start" }, LKO: { dx: 11, dy: 4, anchor: "start" }, CCU: { dx: 11, dy: 4, anchor: "start" },
  GAU: { dx: -11, dy: -10, anchor: "end" }, BBI: { dx: 11, dy: 6, anchor: "start" }, HYD: { dx: 12, dy: 4, anchor: "start" },
  BLR: { dx: -12, dy: -4, anchor: "end" }, MAA: { dx: 11, dy: 4, anchor: "start" }, COK: { dx: -11, dy: 2, anchor: "end" },
  TRV: { dx: 11, dy: 8, anchor: "start" },
};

function ctrl(p: { x: number; y: number }, q: { x: number; y: number }) {
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, dx = q.x - p.x, dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(56, len * 0.16);
  return { x: mx + (-dy / len) * bend, y: my + (dx / len) * bend };
}
function bez(p: { x: number; y: number }, c: { x: number; y: number }, q: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return { x: u * u * p.x + 2 * u * t * c.x + t * t * q.x, y: u * u * p.y + 2 * u * t * c.y + t * t * q.y };
}
/** Route geometry for an undirected pair is always computed from the sorted pair so both directions share one curve. */
function pairGeom(pos: Record<string, { x: number; y: number }>, o: string, d: string) {
  const [a, b] = [o, d].sort();
  const p = pos[a], q = pos[b];
  return { p, q, c: ctrl(p, q), forward: a === o };
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
  chain?: string[]; // ordered flight ids of the highlighted aircraft/causal chain
  highlightFlights?: string[];
  highlightAirports?: string[];
  onSelectFlight?: (id: string) => void;
  showPlanes?: boolean;
  revealKey?: string | number;
  chronological?: boolean;
}) {
  const { net, result, compare, time, selectedFlight, onSelectFlight } = props;
  const pos = useProjection(net);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const s = result.scenario;
  const chain = (props.chain ?? []).filter((id) => result.flightById[id]);
  const hiA = new Set(props.highlightAirports ?? []);
  const focus = new Set([...chain, ...(props.highlightFlights ?? []), ...(selectedFlight ? [selectedFlight] : [])]);
  const focusAirports = new Set<string>([...hiA]);
  for (const id of focus) { const f = result.flightById[id]; if (f) { focusAirports.add(f.flight.origin); focusAirports.add(f.flight.destination); } }
  if (s) focusAirports.add(s.airport);
  const hasFocus = focus.size > 0;
  // Chronology: a flight's computed disruption becomes visible only from the timestamp of its first ledger event.
  const knownAt = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of result.events) if (e.flightId) m[e.flightId] = Math.min(m[e.flightId] ?? Infinity, e.time);
    return m;
  }, [result]);
  const toneAt = (f: SimulatedFlight) => (props.chronological === false || time >= (knownAt[f.flight.id] ?? Infinity) ? flightTone(f, compare) : "normal");

  const routes = useMemo(() => {
    const m = new Map<string, SimulatedFlight[]>();
    for (const f of result.flights) {
      const key = [f.flight.origin, f.flight.destination].sort().join("-");
      (m.get(key) ?? m.set(key, []).get(key)!).push(f);
    }
    return [...m.entries()].map(([key, flights]) => {
      const [a, b] = key.split("-");
      return { key, a, b, flights };
    });
  }, [result]);

  // Purposeful motion only: network reveal on a new scenario, chain draw when the highlighted chain changes.
  useEffect(() => {
    if (!svgRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.from(".ap-node", { scale: 0.4, transformOrigin: "50% 50%", duration: 0.45, stagger: 0.03, ease: "back.out(2)" });

      const safety = setTimeout(() => tl.progress(1), 2500); // never leave the map half-drawn if frames are throttled
      return () => clearTimeout(safety);
    }, svgRef);
    return () => ctx.revert();
  }, [props.revealKey]);
  const chainKey = chain.join(",");
  useEffect(() => {
    if (!svgRef.current || !chainKey || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      // Never hides anything: each leg pulses in flight order, so a throttled frame loop still shows the full chain.
      tl.from(".chain-leg", { strokeWidth: 9, duration: 0.5, stagger: 0.3, ease: "power2.out", clearProps: "strokeWidth" });
      tl.from(".chain-mark", { scale: 1.7, transformOrigin: "50% 50%", duration: 0.35, stagger: 0.3, ease: "back.out(2)" }, 0);
      const safety = setTimeout(() => tl.progress(1), 3000);
      return () => clearTimeout(safety);
    }, svgRef);
    return () => ctx.revert();
  }, [chainKey]);

  const airborne = props.showPlanes === false ? [] : result.flights.filter((f) => f.status !== "cancelled" && f.actualDep! <= time && time < f.actualArr!);
  const hovered = hover ? result.flightById[hover] : null;
  const hoveredRoute = hovered ? result.flights.filter((f) => [f.flight.origin, f.flight.destination].sort().join("-") === [hovered.flight.origin, hovered.flight.destination].sort().join("-")) : [];

  return (
    <div className="relative h-full w-full">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img"
        aria-label="Network map: the 16 dataset airports at their real coordinates, north up, with scheduled routes coloured by simulated status">
        <defs>
          <radialGradient id="closure-glow"><stop offset="0%" stopColor="#F26E73" stopOpacity=".28" /><stop offset="100%" stopColor="#F26E73" stopOpacity="0" /></radialGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#F4F8FC" /></marker>
        </defs>
        <g opacity={0.5}>
          {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={i * 60} x2={i * 60} y1={0} y2={H} stroke="#0f2033" strokeWidth={1} />)}
          {Array.from({ length: 12 }, (_, i) => <line key={`h${i}`} y1={i * 60} y2={i * 60} x1={0} x2={W} stroke="#0f2033" strokeWidth={1} />)}
        </g>
        <text x={W - 18} y={30} fontSize={11} fill="#8aa0b8" textAnchor="end" className="mono">N ↑</text>

        {routes.map((r0) => ({ ...r0, tone: r0.flights.map(toneAt).sort((x, y) => rank[y] - rank[x])[0] })).sort((x, y) => rank[x.tone] - rank[y.tone]).map((r) => {
          const { p, q, c } = pairGeom(pos, r.a, r.b);
          const inFocus = r.flights.some((f) => focus.has(f.flight.id));
          const col = STATUS_COLOR[r.tone];
          const quiet = hasFocus && !inFocus;
          return (
            <g key={r.key}>
              <path className="route" d={`M${p.x},${p.y} Q${c.x},${c.y} ${q.x},${q.y}`} fill="none" stroke={quiet ? "#3a5675" : col}
                strokeWidth={r.tone === "normal" ? 1.1 : 1.8} strokeOpacity={quiet ? 0.18 : r.tone === "normal" ? 0.32 : 0.85}
                strokeDasharray={r.tone === "cancelled" ? "5 5" : undefined} style={{ transition: "stroke .4s, stroke-opacity .4s" }} />
              <path d={`M${p.x},${p.y} Q${c.x},${c.y} ${q.x},${q.y}`} fill="none" stroke="transparent" strokeWidth={14}
                className="cursor-pointer" onMouseEnter={() => setHover(r.flights[0].flight.id)} onMouseLeave={() => setHover(null)}
                onClick={() => onSelectFlight?.(r.flights.slice().sort((x, y) => rank[toneAt(y)] - rank[toneAt(x)])[0].flight.id)}>
                <title>{r.flights.map((f) => `${f.flight.id} ${f.flight.origin}→${f.flight.destination} ${f.status}`).join("\n")}</title>
              </path>
            </g>
          );
        })}

        {/* Highlighted chain: drawn on top, in flight order, with direction and sequence numbers */}
        {chain.map((id, i) => {
          const f = result.flightById[id];
          const { p, q, c, forward } = pairGeom(pos, f.flight.origin, f.flight.destination);
          const tone = toneAt(f);
          // offset the sequence badge toward the leg's origin so out-and-back legs on one curve don't stack
          const mid = bez(p, c, q, forward ? 0.32 : 0.68);
          const d = forward ? `M${p.x},${p.y} Q${c.x},${c.y} ${q.x},${q.y}` : `M${q.x},${q.y} Q${c.x},${c.y} ${p.x},${p.y}`;
          return (
            <g key={`chain-${id}`} className="cursor-pointer" onClick={() => onSelectFlight?.(id)}>
              <path className="chain-leg" d={d} fill="none" stroke={STATUS_COLOR[tone]} strokeWidth={id === selectedFlight ? 4.5 : 3.2}
                strokeDasharray={tone === "cancelled" ? "7 5" : undefined} markerEnd="url(#arrow)" strokeLinecap="round" />
              <g className="chain-mark">
                <circle cx={mid.x} cy={mid.y} r={9} fill="#08121F" stroke={STATUS_COLOR[tone]} strokeWidth={1.6} />
                <text x={mid.x} y={mid.y + 3.5} fontSize={10} textAnchor="middle" fill="#F4F8FC" className="mono" fontWeight={700}>{i + 1}</text>
              </g>
              <title>{`${i + 1}. ${f.flight.id} ${f.flight.origin}→${f.flight.destination} · ${f.status === "cancelled" ? "cancelled" : `${fmt(f.actualDep)}–${fmt(f.actualArr)}${f.delay ? ` (+${f.delay} min)` : ""}`}`}</title>
            </g>
          );
        })}

        {airborne.map((f) => {
          const { p, q, c, forward } = pairGeom(pos, f.flight.origin, f.flight.destination);
          const t = (time - f.actualDep!) / (f.actualArr! - f.actualDep!);
          const pt = bez(p, c, q, forward ? t : 1 - t);
          const tone = toneAt(f);
          const quiet = hasFocus && !focus.has(f.flight.id);
          return (
            <g key={f.flight.id} className="cursor-pointer" onClick={() => onSelectFlight?.(f.flight.id)} opacity={quiet ? 0.35 : 1}>
              <circle cx={pt.x} cy={pt.y} r={9} fill={STATUS_COLOR[tone]} opacity={0.18} />
              <circle cx={pt.x} cy={pt.y} r={4} fill={STATUS_COLOR[tone]} stroke="#08121F" strokeWidth={1.2} />
              <title>{`${f.flight.id} airborne ${fmt(f.actualDep)}→${fmt(f.actualArr)}`}</title>
            </g>
          );
        })}

        {net.airports.map((a) => {
          const p = pos[a.id];
          const closed = s && s.airport === a.id;
          const closedNow = closed && time >= s!.start && time < s!.end;
          const r = a.tier === "mega_hub" ? 7.5 : a.tier === "regional_hub" ? 5.8 : 4.4;
          const lbl = LABEL[a.id] ?? { dx: 10, dy: 4, anchor: "start" as const };
          const dim = hasFocus && !focusAirports.has(a.id);
          return (
            <g key={a.id} opacity={dim ? 0.5 : 1} style={{ transition: "opacity .4s" }}>
              {closed && <circle cx={p.x} cy={p.y} r={40} fill="url(#closure-glow)" />}
              {closedNow && <circle className="closure-ring" cx={p.x} cy={p.y} r={8} fill="none" stroke="#F26E73" strokeWidth={2} />}
              <g className="ap-node">
                {hiA.has(a.id) && !closed && <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke="#F4F8FC" strokeOpacity={0.7} strokeWidth={1.2} />}
                <circle cx={p.x} cy={p.y} r={r} fill={closed ? (closedNow ? "#F26E73" : "#3a1b25") : "#08121F"} stroke={closed ? "#F26E73" : "#65D8EF"} strokeWidth={1.8} />
              </g>
              <text x={p.x + lbl.dx} y={p.y + lbl.dy} fontSize={13} fill="#F4F8FC" textAnchor={lbl.anchor} className="mono" fontWeight={600}
                paintOrder="stroke" stroke="#08121F" strokeWidth={4}>{a.id}</text>
              <text x={p.x + lbl.dx} y={p.y + lbl.dy + 12} fontSize={9.5} fill="#8aa0b8" textAnchor={lbl.anchor} paintOrder="stroke" stroke="#08121F" strokeWidth={3}>{a.city}</text>
              <title>{`${a.name}, ${a.city} · ${a.tier.replace("_", " ")} · capacity ${a.capacityPerHour}/h${closed ? ` · CLOSED ${fmt(s!.start)}–${fmt(s!.end)}` : ""}`}</title>
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute left-3 top-12 rounded-lg bg-night/95 px-3 py-2 text-xs shadow-lg">
          <div className="label mb-1">Route inspector · {hoveredRoute.length} flight{hoveredRoute.length > 1 ? "s" : ""}</div>
          {hoveredRoute.map((f) => {
            const t = toneAt(f);
            return <div key={f.flight.id} className="mono flex gap-3"><span className="font-semibold">{f.flight.id}</span><span className="text-mute">{f.flight.origin}→{f.flight.destination} {fmt(f.flight.dep)}</span><span style={{ color: STATUS_COLOR[t] }}>{t === "normal" ? "normal" : f.status === "cancelled" ? "cancelled" : `${fmt(f.actualDep)} +${f.delay}m`}</span></div>;
          })}
          <div className="mt-1 text-mute">States as known at {fmt(Math.round(time))} simulated time.</div>
        </div>
      )}
    </div>
  );
}
