"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { eventTypeLabel } from "@/engine/simulate";
import { fmt } from "@/engine/time";
import type { Sim } from "@/lib/useSim";
import { useUi } from "@/lib/store";
import { NetworkMap } from "./NetworkMap";

const DWELL = 9000;

export function StoryMode({ sim }: { sim: Sim }) {
  const { storyIndex, set } = useUi();
  const [auto, setAuto] = useState(true);
  const [evidence, setEvidence] = useState(false);
  const [eventIdx, setEventIdx] = useState(-1);
  const textRef = useRef<HTMLDivElement>(null);
  const chapters = sim.story;
  const ch = chapters[Math.min(storyIndex, chapters.length - 1)];
  const winner = sim.report.winner;
  const recovered = winner.result;
  const showRecovered = ch.useRecovered && ch.key === "resolution" && recovered && winner.actions.length > 0;
  const mapResult = showRecovered ? recovered! : sim.disrupted;
  const ledger = ch.useRecovered && recovered ? recovered.events : sim.disrupted.events;
  const chEvents = ch.eventIds.map((id) => ledger.find((e) => e.id === id) ?? sim.disrupted.events.find((e) => e.id === id)).filter(Boolean).slice(0, 8) as typeof ledger;
  const focusEvent = eventIdx >= 0 ? chEvents[eventIdx] : null;
  const mapTime = focusEvent?.time ?? ch.focusTime ?? sim.scenario.start;

  const go = (i: number) => { setEventIdx(-1); setEvidence(false); set({ storyIndex: Math.max(0, Math.min(chapters.length - 1, i)) }); };
  const nextEvent = () => { if (eventIdx < chEvents.length - 1) setEventIdx(eventIdx + 1); else if (storyIndex < chapters.length - 1) go(storyIndex + 1); };
  const prevEvent = () => { if (eventIdx > -1) setEventIdx(eventIdx - 1); else if (storyIndex > 0) go(storyIndex - 1); };
  const exit = () => set({ storyOpen: false });

  useEffect(() => {
    if (!auto) return;
    if (storyIndex >= chapters.length - 1) { setAuto(false); return; }
    const t = setTimeout(() => go(storyIndex + 1), DWELL);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, storyIndex, chapters.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { setAuto(false); nextEvent(); }
      if (e.key === "ArrowLeft") { setAuto(false); prevEvent(); }
      if (e.key === "Escape") exit();
      if (e.key === " ") { e.preventDefault(); setAuto((a) => !a); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!textRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.fromTo(".st-kicker", { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 })
        .fromTo(".st-head", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, "-=0.15")
        .fromTo(".st-sent", { opacity: 0 }, { opacity: 1, duration: 0.4 }, "-=0.2")
        .fromTo(".st-bullet", { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, stagger: 0.12 }, "-=0.1");
    }, textRef);
    return () => ctx.revert();
  }, [storyIndex]);

  const hiFlights = focusEvent?.flightId ? [focusEvent.flightId] : ch.flights;
  const hiAirports = focusEvent?.airport ? [focusEvent.airport] : ch.airports;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-night" role="dialog" aria-label="The Domino Story">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <span className="font-display text-sm font-bold tracking-wide">THE DOMINO STORY</span>
        <span className="text-xs text-mute">{sim.net.airportById[sim.scenario.airport].city} closure {fmt(sim.scenario.start)}–{fmt(sim.scenario.end)} · every scene is built from the simulation ledger</span>
        <div className="ml-auto flex gap-1">
          {chapters.map((c, i) => (
            <button key={c.key} onClick={() => { setAuto(false); go(i); }} aria-label={`Go to ${c.kicker}`}
              className={`h-1.5 w-8 rounded-full transition ${i === storyIndex ? "bg-radar" : i < storyIndex ? "bg-radar/40" : "bg-line"}`} />
          ))}
        </div>
        <button className="btn" onClick={exit} aria-label="Exit Story Mode"><X size={14} />Exit</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        <div className="relative min-h-[320px] border-r border-line p-4">
          <NetworkMap net={sim.net} result={mapResult} compare={showRecovered ? sim.disrupted : null} time={mapTime}
            highlightFlights={ch.key === "normal" ? [] : hiFlights} highlightAirports={hiAirports} revealKey={ch.key === "normal" ? "story" : undefined}
            onSelectFlight={(id) => { set({ storyOpen: false, selectedFlight: id, time: mapResult.flightById[id].actualDep ?? mapResult.flightById[id].flight.dep, view: showRecovered ? "after" : "before", appliedId: showRecovered ? winner.id : useUi.getState().appliedId }); }} />
          <div className="mono absolute left-6 top-6 rounded-md bg-night-3/90 px-2 py-1 text-sm text-radar">{fmt(Math.round(mapTime))} IST{showRecovered ? " · after recovery" : ""}</div>
        </div>
        <div ref={textRef} className="scroll-thin flex min-h-0 flex-col overflow-y-auto p-8">
          <div className="st-kicker label text-radar">{ch.kicker}</div>
          <h2 className="st-head mt-3 font-display text-3xl font-bold leading-tight lg:text-4xl">{ch.headline}</h2>
          <p className="st-sent mt-4 text-lg leading-relaxed text-ice/85" aria-live="polite">{ch.sentence}</p>
          {ch.empty && <p className="mt-2 text-sm text-amber">This scenario did not produce this kind of consequence.</p>}
          <ul className="mt-5 space-y-2">
            {ch.bullets.map((b, i) => <li key={i} className="st-bullet flex gap-2 text-[14.5px] leading-snug"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-radar" />{b}</li>)}
          </ul>
          {ch.times.length > 0 && <div className="mt-4 flex gap-2">{ch.times.map((t) => <span key={t.label} className="chip mono">{t.label} {t.value}</span>)}</div>}
          {chEvents.length > 0 && (
            <div className="mt-6">
              <div className="label mb-2">Supporting ledger events — step through with Next event</div>
              <div className="space-y-1.5">
                {chEvents.map((e, i) => (
                  <button key={e.id} onClick={() => { setAuto(false); setEventIdx(i); }} className={`block w-full rounded-lg border px-3 py-2 text-left text-xs ${i === eventIdx ? "border-radar bg-radar/5" : "border-line"}`}>
                    <span className="mono text-mute">{e.id}</span> · <span className="font-semibold">{eventTypeLabel(e.type)}</span> · <span className="mono text-radar">{fmt(e.time)}</span>
                    {i === eventIdx && <div className="mt-1 text-ice/85">{e.explanation}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {ch.evidence.length > 0 && (
            <div className="mt-4">
              <button className="text-xs text-radar underline-offset-2 hover:underline" onClick={() => setEvidence(!evidence)}>{evidence ? "Hide" : "Show"} the proof</button>
              {evidence && <ol className="mono mt-2 space-y-1 rounded-lg bg-night-2 p-3 text-[11.5px] text-ice/85">{ch.evidence.map((l, i) => <li key={i}>{l}</li>)}</ol>}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-line px-5 py-3">
        <button className="btn" onClick={() => { setAuto(false); go(storyIndex - 1); }} disabled={storyIndex === 0}><ChevronLeft size={14} />Previous scene</button>
        <button className="btn" onClick={() => { setAuto(false); prevEvent(); }}>Previous event</button>
        <button className="btn btn-primary" onClick={() => setAuto(!auto)}>{auto ? <Pause size={14} /> : <Play size={14} />}{auto ? "Pause" : "Play"}</button>
        <button className="btn" onClick={() => { setAuto(false); nextEvent(); }}>Next event</button>
        <button className="btn" onClick={() => { setAuto(false); go(storyIndex + 1); }} disabled={storyIndex === chapters.length - 1}>Next scene<ChevronRight size={14} /></button>
        <button className="btn" onClick={() => { go(0); setAuto(true); }}><RotateCcw size={14} />Replay</button>
        <span className="ml-3 hidden text-[11px] text-mute md:inline">← → step · space play/pause · esc exit · story playback never changes results</span>
      </div>
    </div>
  );
}
