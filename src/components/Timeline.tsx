"use client";
import { useEffect, useMemo, useRef } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { Network, SimulationResult } from "@/engine/types";
import { fmt } from "@/engine/time";
import { useUi } from "@/lib/store";
import { STATUS_COLOR, flightTone } from "./NetworkMap";

export function Timeline({ net, result, compare }: { net: Network; result: SimulationResult; compare: SimulationResult | null }) {
  const { time, playing, speed, selectedFlight, set } = useUi();
  const s = result.scenario;
  const t0 = 300;
  const t1 = Math.max(1380, ...result.flights.map((f) => (f.actualArr ?? 0) + 20));
  const span = t1 - t0;
  const tails = useMemo(() => net.aircraft.map((a) => a.tail), [net]);
  const trackRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      const cur = useUi.getState().time;
      const next = cur + dt * speed * 6; // speed × 6 simulated minutes per second
      if (next >= t1) { set({ time: t1, playing: false }); return; }
      set({ time: next });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed, t1, set]);

  const pct = (t: number) => `${((t - t0) / span) * 100}%`;
  const scrubFrom = (clientX: number) => {
    const el = trackRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 0), r.width);
    set({ time: Math.round(t0 + (x / r.width) * span), playing: false });
  };
  const hours = []; for (let h = Math.ceil(t0 / 60); h * 60 <= t1; h++) hours.push(h * 60);

  return (
    <div className="panel flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="label">Rotation timeline</span>
        <span className="mono ml-2 rounded bg-night-3 px-2 py-0.5 text-sm text-radar" aria-live="polite">{fmt(Math.round(time))} IST</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn" onClick={() => set({ playing: !playing, time: time >= t1 ? t0 : time })} aria-label={playing ? "Pause playback" : "Play playback"}>
            {playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "Pause" : "Play"}
          </button>
          <button className="btn" onClick={() => set({ time: s ? s.start - 30 : t0, playing: false })} aria-label="Reset playback"><RotateCcw size={14} /></button>
          <label className="flex items-center gap-1 text-xs text-mute">Speed
            <select className="rounded-md border border-line bg-night-2 px-1.5 py-1 text-xs text-ice" value={speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
              {[1, 2, 4, 8, 16].map((v) => <option key={v} value={v}>{v}×</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="relative flex-1 overflow-auto scroll-thin pr-1">
        <div className="relative ml-[84px] min-w-[860px]" ref={trackRef}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); scrubFrom(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons === 1) scrubFrom(e.clientX); }}>
          <div className="sticky top-0 z-10 h-5 bg-night-2/90">
            {hours.map((h) => <span key={h} className="mono absolute -translate-x-1/2 text-[11px] text-mute" style={{ left: pct(h) }}>{fmt(h).slice(0, 2)}</span>)}
          </div>
          {s && <div className="absolute bottom-0 top-5 bg-coral/12 border-x border-coral/50" style={{ left: pct(s.start), width: `${((s.end - s.start) / span) * 100}%` }} title={`${s.airport} closed ${fmt(s.start)}–${fmt(s.end)}`} />}
          {tails.map((tail) => {
            const legs = result.flights.filter((f) => f.tail === tail);
            const planned = result.flights.filter((f) => f.flight.tail === tail);
            const isSpare = net.aircraftByTail[tail].isSpare;
            return (
              <div key={tail} className="relative h-[28px] border-b border-line/30">
                <span className={`mono absolute -left-[84px] top-[6px] text-xs ${isSpare ? "text-mint" : "text-mute"}`}>{tail}{isSpare ? "*" : ""}</span>
                {planned.map((f) => (
                  <div key={`g${f.flight.id}`} className="absolute top-[5px] h-[18px] rounded-[4px] border border-dashed border-ice/25"
                    style={{ left: pct(f.flight.dep), width: pct(t0 + f.flight.block) }} />
                ))}
                {legs.map((f) => {
                  const tone = flightTone(f, compare);
                  const sel = selectedFlight === f.flight.id;
                  const start = f.actualDep ?? f.flight.dep;
                  return (
                    <button key={f.flight.id} onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => set({ selectedFlight: f.flight.id, time: start })}
                      className="mono absolute top-[5px] h-[18px] overflow-hidden whitespace-nowrap rounded-[4px] px-1 text-left text-[11px] font-semibold leading-[18px]"
                      style={{
                        left: pct(start), width: pct(t0 + f.flight.block),
                        background: tone === "cancelled" ? "transparent" : STATUS_COLOR[tone], color: "#08121F",
                        border: tone === "cancelled" ? `1.5px solid ${STATUS_COLOR.cancelled}` : "none",
                        outline: sel ? "2px solid #F4F8FC" : undefined, opacity: tone === "normal" && !sel ? 0.55 : 1,
                      }}
                      aria-label={`${f.flight.id} ${f.flight.origin} to ${f.flight.destination}, ${f.status}${f.delay ? `, ${f.delay} minutes late` : ""}`}>
                      <span style={{ color: tone === "cancelled" ? STATUS_COLOR.cancelled : undefined }}>{f.flight.block >= 55 ? f.flight.id : f.flight.id.slice(2)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-ice" style={{ left: pct(time) }}>
            <div className="absolute -left-[4px] top-4 h-2 w-2 rotate-45 bg-ice" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-mute">
        <Legend c={STATUS_COLOR.normal} t="On time" /><Legend c={STATUS_COLOR.delayed} t="Delayed" />
        <Legend c={STATUS_COLOR.cancelled} t="Cancelled" outline /><Legend c={STATUS_COLOR.improved} t="Improved by recovery" />
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-ice/40" />Scheduled slot</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm bg-coral/30 border-x border-coral" />Closure</span>
        <span>* spare aircraft · drag the track to scrub</span>
      </div>
    </div>
  );
}

function Legend({ c, t, outline }: { c: string; t: string; outline?: boolean }) {
  return <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm" style={outline ? { border: `1.5px solid ${c}` } : { background: c }} />{t}</span>;
}
