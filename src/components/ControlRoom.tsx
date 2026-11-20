"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { Box, Clapperboard, HelpCircle, Info, Lightbulb, Map as MapIcon, PanelRightClose, PanelRightOpen, RotateCcw, ScrollText, SlidersHorizontal, Zap } from "lucide-react";
import { fmt, fmtDur, parseHHMM } from "@/engine/time";
import { validateScenario } from "@/engine/simulate";
import type { Kpis, SimulatedFlight } from "@/engine/types";
import { useSim, type Sim } from "@/lib/useSim";
import { useUi, type Mode, type StageView } from "@/lib/store";
import { NetworkMap } from "./NetworkMap";
import { Timeline } from "./Timeline";
import { FlightDrawer } from "./FlightDrawer";
import { RecoveryPanel, METRICS, Delta } from "./RecoveryPanel";
import { EventLedger } from "./EventLedger";
import { IncidentBrief } from "./IncidentBrief";
import { StoryMode } from "./StoryMode";
import { Intro } from "./Intro";

// WebGL is code-split and client-only: it never enters the main bundle or blocks first paint.
const JourneyLab3D = dynamic(() => import("./three/JourneyLab3D"), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-[460px] items-center justify-center rounded-2xl bg-[#060d17] text-sm text-mute">Preparing the 3D apron…</div>,
});

const n = (x: number) => x.toLocaleString("en-IN");

function useChain(sim: Sim) {
  const ui = useUi();
  const selTail = ui.selectedFlight ? sim.shown.flightById[ui.selectedFlight]?.tail : null;
  const chainTail = selTail ?? sim.story.find((c) => c.key === "cascade" && !c.empty)?.tails[0] ?? null;
  const chainLegs = chainTail ? sim.shown.flights.filter((f) => f.tail === chainTail).sort((a, b) => a.flight.dep - b.flight.dep) : [];
  return { selTail, chainTail, chainLegs };
}

export function ControlRoom() {
  const sim = useSim();
  const ui = useUi();
  const modeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem("ds-intro-seen") === "1"; } catch {}
    if (!seen) ui.set({ introOpen: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Mode transition: transform-only, so content is never hidden if frames are throttled.
  useEffect(() => {
    if (!modeRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tw = gsap.from(modeRef.current, { y: 14, duration: 0.45, ease: "power3.out", clearProps: "transform" });
    return () => { tw.kill(); };
  }, [ui.mode]);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar sim={sim} />
      <div ref={modeRef} className="flex flex-1 flex-col">
        {ui.mode === "control" && <ControlMode sim={sim} />}
        {ui.mode === "investigate" && <InvestigateMode sim={sim} />}
        {ui.mode === "recover" && <RecoverMode sim={sim} />}
      </div>
      <footer className="px-4 pb-4 pt-2 text-[11.5px] text-mute xl:px-6">
        Interactive deterministic simulation of the organisers&apos; single-day dataset (all times IST). Not live airline data. Every number is computed by the engine; AI text, when enabled, only explains engine-verified candidates.
      </footer>
      {ui.storyOpen && <StoryMode sim={sim} />}
      {ui.introOpen && <Intro sim={sim} />}
      {ui.helpOpen && <WhatAmI sim={sim} />}
    </div>
  );
}

/* ------------------------------- Top bar ------------------------------- */

function TopBar({ sim }: { sim: Sim }) {
  const ui = useUi();
  const s = sim.scenario;
  const modes: { k: Mode; l: string; hint: string }[] = [
    { k: "control", l: "Control", hint: "The network and the incident" },
    { k: "investigate", l: "Investigate", hint: "One flight, its chain and its proof" },
    { k: "recover", l: "Recover", hint: "Evaluated plans and their outcomes" },
  ];
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 xl:px-6">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-lg font-bold tracking-[0.08em]">DOMINO SKY</span>
        <span className="font-display text-lg font-bold tracking-[0.08em] text-radar">/ CONTROL</span>
      </div>
      <nav className="flex rounded-xl bg-night-2 p-1" aria-label="Modes">
        {modes.map((m) => (
          <button key={m.k} title={m.hint} aria-current={ui.mode === m.k ? "page" : undefined}
            onClick={() => ui.set({ mode: m.k })}
            className={`rounded-lg px-4 py-1.5 font-display text-sm font-semibold tracking-wide transition ${ui.mode === m.k ? "bg-radar text-night" : "text-mute hover:text-ice"}`}>
            {m.l.toUpperCase()}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button className="mono hidden rounded-lg bg-night-2 px-3 py-1.5 text-xs text-ice/85 hover:text-radar lg:inline" onClick={() => ui.set({ mode: "control", scenarioOpen: true })}>
          {sim.net.airportById[s.airport].city} closed {fmt(s.start)}–{fmt(s.end)} · {sim.applied ? (ui.view === "after" ? "recovery applied" : "showing before") : "simulated"}
        </button>
        <button className="btn btn-primary" onClick={() => ui.set({ storyOpen: true, storyIndex: 0 })}><Clapperboard size={14} />Story</button>
        <button className={`btn ${ui.guide ? "border-amber text-amber" : ""}`} onClick={() => ui.set({ guide: !ui.guide })} aria-pressed={ui.guide} aria-label="Guide me"><Lightbulb size={14} /><span className="hidden sm:inline">Guide</span></button>
        <button className="btn" onClick={() => ui.set({ helpOpen: true })} aria-label="What am I looking at?"><HelpCircle size={14} /><span className="hidden sm:inline">Help</span></button>
        <button className="btn" onClick={() => ui.reset()} aria-label="Reset to default scenario"><RotateCcw size={14} /></button>
      </div>
    </header>
  );
}

/* ------------------------------- CONTROL ------------------------------- */

function ControlMode({ sim }: { sim: Sim }) {
  const ui = useUi();
  const compare = ui.view === "after" && sim.recovered ? sim.disrupted : null;
  const { selTail, chainTail, chainLegs } = useChain(sim);
  return (
    <>
      <KpiStrip sim={sim} />
      <main className="flex flex-col gap-4 px-4 pb-2 xl:px-6">
        <section className="relative overflow-hidden rounded-[20px] bg-[#0a1626] lg:h-[calc(100vh-230px)] lg:min-h-[620px]" aria-label="Network map">
          <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: "radial-gradient(60% 50% at 40% 45%, rgba(101,216,239,.07), transparent 70%)" }} />
          <div className="absolute left-4 top-3 z-20 flex flex-wrap items-center gap-2">
            <button className="btn bg-night/80" onClick={() => ui.set({ scenarioOpen: !ui.scenarioOpen })} aria-expanded={ui.scenarioOpen}>
              <SlidersHorizontal size={14} />{ui.scenarioOpen ? "Hide scenario" : "Change scenario"}
            </button>
            <button className="mono flex items-center gap-1.5 rounded-lg bg-night/80 px-3 py-1.5 text-sm text-radar" onClick={() => ui.set({ playing: !ui.playing, time: ui.time >= 1380 ? sim.scenario.start - 30 : ui.time })} aria-label={ui.playing ? "Pause simulated time" : "Play simulated time"}>
              {ui.playing ? "❚❚" : "▶"} {fmt(Math.round(ui.time))} IST
            </button>
            <span className="hidden text-xs text-mute md:inline">Map shows each flight as known at this simulated time</span>
            {sim.recovered && (
              <div className="flex rounded-lg bg-night p-0.5 text-xs font-semibold" role="group" aria-label="Before and after">
                {(["before", "after"] as const).map((v) => (
                  <button key={v} onClick={() => ui.set({ view: v })} className={`rounded-md px-2.5 py-1 ${ui.view === v ? (v === "after" ? "bg-mint text-night" : "bg-amber text-night") : "text-mute"}`}>{v === "before" ? "Before" : "After recovery"}</button>
                ))}
              </div>
            )}
          </div>
          <MapLegend />
          <div className="h-[118vw] max-h-[640px] px-2 pb-2 pt-20 lg:absolute lg:inset-0 lg:h-auto lg:max-h-none lg:pr-[430px]">
            <NetworkMap net={sim.net} result={sim.shown} compare={compare} time={ui.time} selectedFlight={ui.selectedFlight}
              chain={chainLegs.map((f) => f.flight.id)} onSelectFlight={(id) => ui.set({ selectedFlight: id, briefOpen: true })} revealKey={ui.scenarioKey} />
          </div>
          {ui.scenarioOpen && (
            <div className="z-30 p-3 lg:absolute lg:left-3 lg:top-14 lg:w-[340px] lg:p-0">
              <ScenarioPanel sim={sim} />
            </div>
          )}
          {chainTail && chainLegs.length > 0 && (
            <div className="z-10 m-3 rounded-2xl bg-night/90 p-4 text-[13px] lg:absolute lg:bottom-3 lg:right-[434px] lg:m-0 lg:w-[340px]">
              <div className="label">{selTail ? "Selected aircraft" : "Longest knock-on chain"} · <span className="mono text-ice">{chainTail}</span></div>
              <ol className="mt-2 space-y-1">
                {chainLegs.map((f, i) => (
                  <li key={f.flight.id}>
                    <button className={`mono flex w-full gap-2 rounded-md px-1 text-left hover:text-radar ${ui.selectedFlight === f.flight.id ? "bg-night-3" : ""}`} onClick={() => ui.set({ selectedFlight: f.flight.id, time: f.actualDep ?? f.flight.dep })}>
                      <span className="w-4 text-mute">{i + 1}</span><span className="w-16 font-semibold">{f.flight.id}</span><span className="w-20 text-mute">{f.flight.origin}→{f.flight.destination}</span>
                      <span className={`ml-auto ${f.status === "cancelled" ? "text-coral" : f.delay ? "text-amber" : "text-mint"}`}>{f.status === "cancelled" ? "CXL" : f.delay ? `+${f.delay}m` : "on time"}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-primary" onClick={() => ui.set({ mode: "investigate", stageView: "aircraft3d", selectedFlight: ui.selectedFlight ?? chainLegs.find((f) => f.status !== "on_time")?.flight.id ?? chainLegs[0].flight.id })}><Box size={14} />Investigate in 3D</button>
                <button className="btn" onClick={() => ui.set({ mode: "investigate", stageView: "evidence", selectedFlight: ui.selectedFlight ?? chainLegs.find((f) => f.status !== "on_time")?.flight.id ?? chainLegs[0].flight.id })}><ScrollText size={14} />Evidence</button>
              </div>
            </div>
          )}
          <div className={`z-20 lg:absolute lg:bottom-3 lg:right-3 lg:top-3 ${ui.briefOpen ? "lg:w-[410px]" : ""}`}>
            {ui.briefOpen ? (
              <div className="scroll-thin m-3 h-full overflow-y-auto rounded-2xl bg-night/92 p-5 backdrop-blur-sm lg:m-0">
                <button className="float-right text-mute hover:text-ice" onClick={() => ui.set({ briefOpen: false })} aria-label="Collapse incident brief"><PanelRightClose size={16} /></button>
                <IncidentBrief sim={sim} />
              </div>
            ) : (
              <button className="btn m-3 bg-night/90 lg:m-0" onClick={() => ui.set({ briefOpen: true })}><PanelRightOpen size={14} />Incident brief</button>
            )}
          </div>
          {ui.guide && <GuideOverlay sim={sim} />}
        </section>
        <Timeline net={sim.net} result={sim.shown} compare={compare} focusTail={chainTail} />
      </main>
    </>
  );
}

/* ------------------------------ INVESTIGATE ------------------------------ */

function InvestigateMode({ sim }: { sim: Sim }) {
  const ui = useUi();
  const compare = ui.view === "after" && sim.recovered ? sim.disrupted : null;
  const { chainTail, chainLegs } = useChain(sim);
  const affected = useMemo(() => sim.shown.flights.filter((f) => f.status !== "on_time").sort((a, b) => a.flight.dep - b.flight.dep), [sim.shown]);
  useEffect(() => {
    if (ui.selectedFlight) return;
    const first = sim.shown.events.filter((e) => e.type === "closure_constraint").sort((a, b) => a.time - b.time || a.seq - b.seq)[0];
    const fid = first?.flightId ?? affected[0]?.flight.id ?? null;
    if (fid) ui.set({ selectedFlight: fid, time: first?.time ?? sim.shown.flightById[fid].flight.dep });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sel: SimulatedFlight | null = ui.selectedFlight ? sim.shown.flightById[ui.selectedFlight] : null;
  const views: { k: StageView; l: string; icon: React.ReactNode }[] = [
    { k: "network", l: "Network reconstruction", icon: <MapIcon size={14} /> },
    { k: "aircraft3d", l: "Aircraft journey 3D", icon: <Box size={14} /> },
    { k: "evidence", l: "Timeline & causal evidence", icon: <ScrollText size={14} /> },
  ];
  return (
    <main className="grid flex-1 grid-cols-1 gap-4 px-4 pb-2 lg:grid-cols-[minmax(0,1fr)_440px] xl:px-6">
      <section className="flex min-h-[560px] min-w-0 flex-col gap-3 lg:h-[calc(100vh-150px)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-night-2 p-1" role="tablist" aria-label="Investigation view">
            {views.map((v) => (
              <button key={v.k} role="tab" aria-selected={ui.stageView === v.k} onClick={() => ui.set({ stageView: v.k })}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${ui.stageView === v.k ? "bg-night-3 text-radar" : "text-mute hover:text-ice"}`}>{v.icon}{v.l}</button>
            ))}
          </div>
          <div className="scroll-thin flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
            {affected.map((f) => (
              <button key={f.flight.id} onClick={() => ui.set({ selectedFlight: f.flight.id, time: f.actualDep ?? f.flight.dep })}
                className={`chip mono shrink-0 ${ui.selectedFlight === f.flight.id ? "border-radar text-radar" : ""}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${f.status === "cancelled" ? "bg-coral" : "bg-amber"}`} />{f.flight.id}
              </button>
            ))}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {ui.stageView === "network" && (
            <div className="relative h-[118vw] max-h-[640px] rounded-[20px] bg-[#0a1626] p-2 lg:h-full lg:max-h-none">
              <div className="absolute left-4 top-3 z-10 label">Network reconstruction · {fmt(Math.round(ui.time))} simulated · aircraft {chainTail}</div>
              <div className="h-full pt-6">
                <NetworkMap net={sim.net} result={sim.shown} compare={compare} time={ui.time} selectedFlight={ui.selectedFlight}
                  chain={chainLegs.map((f) => f.flight.id)} onSelectFlight={(id) => ui.set({ selectedFlight: id })} />
              </div>
            </div>
          )}
          {ui.stageView === "aircraft3d" && sel && (
            <div className="h-[520px] lg:h-full">
              <JourneyLab3D net={sim.net} sim={sel} result={sim.shown} before={compare?.flightById[sel.flight.id] ?? null}
                onEvidence={() => ui.set({ stageView: "evidence" })} onMap={() => ui.set({ stageView: "network" })} />
            </div>
          )}
          {ui.stageView === "evidence" && (
            <div className="grid h-full grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
              <Timeline net={sim.net} result={sim.shown} compare={compare} focusTail={chainTail} />
              <div className="panel min-h-[420px] p-4"><EventLedger result={sim.shown} /></div>
            </div>
          )}
        </div>
      </section>
      <aside className="panel min-h-[560px] overflow-hidden lg:h-[calc(100vh-150px)]" aria-label="Flight explanation and proof">
        <FlightDrawer net={sim.net} result={sim.shown} compare={compare} inline />
      </aside>
    </main>
  );
}

/* ------------------------------- RECOVER ------------------------------- */

function RecoverMode({ sim }: { sim: Sim }) {
  const plan = sim.applied ?? sim.report.winner;
  const applied = !!sim.applied;
  const before = sim.disrupted;
  const after = plan.result ?? sim.disrupted;
  const changed = after.flights.filter((f) => { const b = before.flightById[f.flight.id]; return b.status !== f.status || b.actualDep !== f.actualDep || b.tail !== f.tail; });
  const focusTail = changed[0]?.tail ?? null;
  const ui = useUi();
  return (
    <main className="grid flex-1 grid-cols-1 gap-4 px-4 pb-2 lg:grid-cols-[460px_minmax(0,1fr)] xl:px-6">
      <section className="panel scroll-thin p-5 lg:h-[calc(100vh-150px)] lg:overflow-y-auto" aria-label="Recovery plans">
        <div className="label text-radar">Recovery intelligence</div>
        <h2 className="mt-1 font-display text-2xl font-bold leading-tight">{sim.report.winner.actions.length ? "One plan leads. Here is the proof." : "No plan beats doing nothing."}</h2>
        <p className="mb-4 mt-2 text-[15px] leading-relaxed text-ice/80">Every option below was fully re-simulated on the same day, checked against turnaround, closure, crew-duty and position rules, then ranked by the objective you choose.</p>
        <RecoveryPanel sim={sim} />
      </section>
      <section className="scroll-thin flex min-w-0 flex-col gap-4 lg:h-[calc(100vh-150px)] lg:overflow-y-auto" aria-label="Before and after">
        <div className="panel p-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="label" style={{ color: applied ? "#78E9C4" : "#F4BA65" }}>{applied ? "Applied plan" : "Preview · recommended plan (not applied)"}</span>
            <span className="mono text-xs text-mute">rank #{plan.rank} · {plan.id}</span>
          </div>
          <h3 className="mt-1 font-display text-xl font-semibold">{plan.title}</h3>
          <ComparisonBars before={before.kpis} after={after.kpis} />
          <div className="mt-4 label">Flights whose computed outcome changes · {changed.length}</div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {changed.length === 0 && <p className="text-sm text-mute">No flight changes under this plan.</p>}
            {changed.map((f) => {
              const b = before.flightById[f.flight.id];
              return (
                <button key={f.flight.id} onClick={() => ui.set({ mode: "investigate", stageView: "aircraft3d", selectedFlight: f.flight.id, view: applied ? "after" : "before" })}
                  className="mono flex items-center gap-2 rounded-lg bg-night px-3 py-2 text-left text-[12.5px] hover:ring-1 hover:ring-radar/60">
                  <span className="font-semibold">{f.flight.id}</span><span className="text-mute">{f.flight.origin}→{f.flight.destination}</span>
                  <span className="ml-auto text-amber">{b.status === "cancelled" ? "CXL" : `+${b.delay}`}</span><span className="text-mute">→</span>
                  <span className={f.status === "cancelled" ? "text-coral" : f.delay < b.delay || b.status === "cancelled" ? "text-mint" : "text-amber"}>{f.status === "cancelled" ? "CXL" : `+${f.delay}`}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4">
          <div className="relative h-[420px] rounded-[20px] bg-[#0a1626] p-2">
            <div className="absolute left-4 top-3 z-10 label">After recovery · mint = improved by the plan</div>
            <div className="h-full pt-6"><NetworkMap net={sim.net} result={after} compare={before} time={sim.scenario.end} chronological={false} highlightFlights={changed.map((f) => f.flight.id)} onSelectFlight={(id) => ui.set({ mode: "investigate", selectedFlight: id, view: applied ? "after" : "before" })} /></div>
          </div>
          <Timeline net={sim.net} result={after} compare={before} focusTail={focusTail} />
        </div>
        {sim.applied && <BeforeAfter sim={sim} />}
      </section>
    </main>
  );
}

function ComparisonBars({ before, after }: { before: Kpis; after: Kpis }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => { gsap.from(".cmp-after", { scaleX: 0.85, transformOrigin: "0% 50%", duration: 0.6, stagger: 0.06, ease: "power2.out" }); }, ref);
    return () => ctx.revert();
  }, [after]);
  return (
    <div ref={ref} className="mt-4 space-y-3">
      {METRICS.map((m) => {
        const b = before[m.k], a = after[m.k];
        const max = Math.max(b, a, 1);
        return (
          <div key={m.k}>
            <div className="flex items-baseline justify-between text-[13px]"><span className="text-ice/85">{m.label}</span><span className="mono"><span className="text-mute">{n(b)} → </span>{n(a)} <span className="ml-1"><Delta v={a - b} /></span></span></div>
            <div className="mt-1 space-y-0.5">
              <div className="h-2 rounded-full bg-amber/70" style={{ width: `${(b / max) * 100}%` }} title={`Before: ${n(b)}`} />
              <div className="cmp-after h-2 rounded-full" style={{ width: `${(a / max) * 100}%`, background: a < b ? "#78E9C4" : a > b ? "#F26E73" : "#65D8EF" }} title={`After: ${n(a)}`} />
            </div>
          </div>
        );
      })}
      <div className="flex gap-4 text-[11px] text-mute"><span><span className="mr-1 inline-block h-2 w-4 rounded bg-amber/70" />Before (disrupted)</span><span><span className="mr-1 inline-block h-2 w-4 rounded bg-mint" />After (better)</span><span><span className="mr-1 inline-block h-2 w-4 rounded bg-coral" />After (worse)</span></div>
    </div>
  );
}


function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = n(value); prev.current = value; return; }
    const o = { v: prev.current };
    const tw = gsap.to(o, { v: value, duration: 0.8, ease: "power2.out", onUpdate: () => { el.textContent = n(Math.round(o.v)); }, onComplete: () => { el.textContent = n(value); } });
    prev.current = value;
    return () => { tw.kill(); el.textContent = n(value); };
  }, [value]);
  return <span ref={ref}>{n(value)}</span>;
}

function KpiStrip({ sim }: { sim: Sim }) {
  const view = useUi((s) => s.view);
  const k = sim.shown.kpis;
  const base = view === "after" && sim.recovered ? sim.disrupted.kpis : null;
  const items: { key: keyof Kpis; label: string; sub: string; tip: string; tone: string }[] = [
    { key: "flightsAffected", label: "Flights affected", sub: `${k.delayedFlights} delayed · ${k.cancelledFlights} cancelled`, tip: "Delayed operated flights plus cancelled flights. A cancelled flight is never also counted as delayed.", tone: "#F4BA65" },
    { key: "strandedProxy", label: "Modelled stranded-passenger cases", sub: `${n(k.cancelledPax)} on cancelled · ${n(k.timingMissedConnectionPax)} missed on timing`, tip: "Operational proxy, not unique people: boardings on cancelled flights + passengers in connection groups missed by timing while both legs flew. Groups broken by a cancellation are already inside the cancelled boardings so are not added twice. The dataset has no passenger identities, so one traveller on two cancelled flights counts twice.", tone: "#F26E73" },
    { key: "totalFlightDelay", label: "Total flight delay (min)", sub: `${n(k.paxDelayMinutes)} passenger-minutes · max ${k.maxDelay} min`, tip: "Sum of departure delays of operated flights. Passenger-minutes weight each delay by that flight's booked passengers.", tone: "#F4BA65" },
    { key: "missedConnectionPax", label: "Missed-connection passengers", sub: `${k.missedConnectionGroups} of ${sim.net.connections.length} groups broken`, tip: "Passengers in connection groups whose onward flight leaves before inbound arrival + minimum connection time, or where either leg is cancelled.", tone: "#F26E73" },
    { key: "crewDutyAlerts", label: "Crew duty alerts", sub: `${k.crewsNearLimit} crews within 30 min of limit`, tip: "Flights that would push their crew past max_duty_mins. They are not flown (no reserve crew exists); aircraft and crew stay put.", tone: "#F26E73" },
  ];
  const [details, setDetails] = useState(false);
  const primary = [items[0], items[2], items[1]];
  const shownItems = details ? [...primary, items[3], items[4]] : primary;
  return (
    <div className="px-4 pb-4 xl:px-6">
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-3 ${details ? "md:grid-cols-5" : ""}`}>
      {shownItems.map((it) => (
        <div key={it.key} className="panel group relative px-5 py-4">
          <div className="label flex items-center gap-1">{it.label}<span title={it.tip} aria-label={it.tip}><Info size={11} className="cursor-help" /></span></div>
          <div className="mono mt-2 flex items-baseline gap-2 text-[34px] font-semibold leading-none tracking-tight" style={{ color: k[it.key] ? it.tone : "#78E9C4" }}>
            <AnimatedNumber value={k[it.key]} />
            {base && <span className="text-xs"><Delta v={k[it.key] - base[it.key]} /></span>}
          </div>
          <div className="mt-2 text-xs text-mute">{it.sub}</div>
          <div className="pointer-events-none absolute left-2 right-2 top-full z-40 mt-1 hidden rounded-lg border border-line bg-night p-2 text-[11px] leading-snug text-ice/90 group-hover:block">{it.tip}</div>
        </div>
      ))}
    </div>
    <button className="mt-2 text-xs text-radar hover:underline" onClick={() => setDetails(!details)} aria-expanded={details}>{details ? "Hide details" : `Details: missed connections (${n(k.missedConnectionPax)} pax) · crew duty alerts (${k.crewDutyAlerts})`}</button>
    </div>
  );
}

function ScenarioPanel({ sim }: { sim: Sim }) {
  const ui = useUi();
  const [startText, setStartText] = useState(fmt(ui.start));
  useEffect(() => setStartText(fmt(ui.start)), [ui.start]);
  const problems = useMemo(() => {
    let st = NaN; try { st = parseHHMM(startText); } catch {}
    if (Number.isNaN(st)) return ["Start time must be HH:MM (24-hour)."];
    return validateScenario(sim.net, { airport: ui.airport, start: st, end: st + ui.duration });
  }, [startText, ui.airport, ui.duration, sim.net]);
  const dirty = ui.airport !== sim.scenario.airport || startText !== fmt(sim.scenario.start) || ui.duration !== sim.scenario.end - sim.scenario.start;
  const ap = sim.net.airportById[ui.airport];
  const k = sim.disrupted.kpis;
  return (
    <section className="scroll-thin flex max-h-[calc(100vh-260px)] flex-col gap-4 overflow-y-auto rounded-2xl bg-night/95 p-5 shadow-2xl backdrop-blur-sm" aria-label="Scenario controls">
      <div>
        <div className="label text-radar">01 · Create the storm</div>
        <p className="mt-2 font-display text-[17px] leading-snug">Imagine <span className="text-radar">{ap.city}</span> airport closes for <span className="text-radar">{fmtDur(ui.duration)}</span>. What happens to the rest of India?</p>
      </div>
      <label className="block text-xs text-mute">Airport
        <select className="mt-1 w-full rounded-lg border border-line bg-night px-2 py-2 text-sm text-ice" value={ui.airport} onChange={(e) => ui.set({ airport: e.target.value })}>
          {sim.net.airports.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.city} ({a.tier.replace("_", " ")})</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-mute">Closes at (IST)
          <input type="time" step={300} className="mono mt-1 w-full rounded-lg border border-line bg-night px-2 py-2 text-sm text-ice [color-scheme:dark]" value={startText}
            onChange={(e) => { setStartText(e.target.value); try { ui.set({ start: parseHHMM(e.target.value) }); } catch {} }} />
        </label>
        <label className="block text-xs text-mute">Duration
          <select className="mono mt-1 w-full rounded-lg border border-line bg-night px-2 py-2 text-sm text-ice" value={ui.duration} onChange={(e) => ui.set({ duration: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720].map((d) => <option key={d} value={d}>{fmtDur(d)}</option>)}
          </select>
        </label>
      </div>
      {problems.length > 0 && <p className="text-xs text-coral" role="alert">{problems.join(" ")}</p>}
      <button className="btn btn-primary justify-center py-2.5 text-sm" disabled={problems.length > 0} onClick={() => { const st = parseHHMM(startText); ui.set({ start: st }); ui.simulate(); }}>
        <Zap size={15} />{dirty ? "Run new scenario" : "Re-run this scenario"}
      </button>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {[["BOM", "08:00", 90], ["BLR", "12:00", 120], ["DEL", "15:00", 90], ["CCU", "18:00", 90], ["HYD", "11:00", 120]].map(([a, t, d]) => (
          <button key={`${a}${t}`} className="chip hover:border-radar" onClick={() => { ui.set({ airport: a as string, start: parseHHMM(t as string), duration: d as number }); setTimeout(() => useUi.getState().simulate(), 0); }}>{a} {t} · {fmtDur(d as number)}</button>
        ))}
      </div>
      {dirty ? <p className="text-xs text-amber">Inputs changed — run the new scenario to recompute.</p> : <p className="text-xs text-mint">✓ Simulated: {sim.net.airportById[sim.scenario.airport].city} {fmt(sim.scenario.start)}–{fmt(sim.scenario.end)}. Results below are computed.</p>}
      <div className="border-t border-line pt-3">
        <div className="label">02 · What happened</div>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-snug">
          <li><span className="mono text-amber">{k.delayedFlights}</span> flights delayed, <span className="mono text-coral">{k.cancelledFlights}</span> cancelled, across <span className="mono">{k.airportsImpacted}</span> airports.</li>
          <li><span className="mono text-amber">{n(k.delayedPax)}</span> passengers on delayed flights; worst delay <span className="mono">{k.maxDelay}</span> min.</li>
          <li><span className="mono text-coral">{k.missedConnectionPax}</span> passengers in broken connections.</li>
          <li>{k.crewDutyAlerts ? <><span className="mono text-coral">{k.crewDutyAlerts}</span> flights stopped by crew duty limits.</> : "No crew duty limit is broken."}</li>
          <li>Capacity check: {k.capacityExceedances ? <span className="text-coral">{k.capacityExceedances} airport-hours over capacity_per_hour</span> : "no airport exceeds its hourly capacity"} (monitored, not enforced).</li>
        </ul>
        <button className="mt-3 text-xs text-radar hover:underline" onClick={() => ui.set({ tab: "flights" })}>See affected flights →</button>
      </div>
      <div className="rounded-lg bg-night p-3 text-[11px] leading-snug text-mute">
        <span className="font-semibold text-ice">Closure policy.</span> Departures inside the window wait for reopening. Arrivals that would land inside it are held on the ground at their origin so they land at reopening — no mid-air holding, diversions or ferry flights are invented.
      </div>
    </section>
  );
}

function BeforeAfter({ sim }: { sim: Sim }) {
  const a = sim.applied!;
  const before = sim.disrupted, after = a.result!;
  const improvedFlights = after.flights.filter((f) => { const b = before.flightById[f.flight.id]; const w = (x: typeof f) => x.status === "cancelled" ? 1e4 : x.delay; return w(f) < w(b); });
  const worse = after.flights.filter((f) => { const b = before.flightById[f.flight.id]; const w = (x: typeof f) => x.status === "cancelled" ? 1e4 : x.delay; return w(f) > w(b); });
  const fixedConn = after.connections.filter((c) => c.status === "made" && before.connections.find((x) => x.connection.id === c.connection.id)!.status !== "made");
  const stillBroken = after.connections.filter((c) => c.status !== "made");
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-mint/50 p-3">
      <div className="label text-mint">05 · See the difference</div>
      <table className="mono w-full text-[11.5px]">
        <thead><tr className="text-mute"><th className="text-left font-normal">Metric</th><th className="text-right font-normal">Before</th><th className="text-right font-normal">After</th><th className="text-right font-normal">Δ</th></tr></thead>
        <tbody>{METRICS.map((m) => <tr key={m.k} className="border-t border-line/50"><td className="py-1 font-sans">{m.label}</td><td className="text-right">{n(before.kpis[m.k])}</td><td className="text-right">{n(after.kpis[m.k])}</td><td className="text-right"><Delta v={after.kpis[m.k] - before.kpis[m.k]} /></td></tr>)}</tbody>
      </table>
      <QA q="What improved?" a={[...fixedConn.map((c) => `${c.connection.id}: ${c.connection.passengers} passengers now connect (${c.slack} min spare).`), ...improvedFlights.map((f) => `${f.flight.id}: ${before.flightById[f.flight.id].status === "cancelled" ? "now operates" : `delay ${before.flightById[f.flight.id].delay} → ${f.delay} min`}.`)]} empty="No individual flight or connection improved." />
      <QA q="What did we sacrifice?" a={worse.map((f) => `${f.flight.id} (${f.flight.pax} pax): ${f.status === "cancelled" ? "cancelled" : `delay ${before.flightById[f.flight.id].delay} → ${f.delay} min`}.`)} empty="Nothing got worse for any flight." />
      <QA q="Which passengers remain affected?" a={[...stillBroken.map((c) => `${c.connection.id}: ${c.connection.passengers} passengers (${c.status.replace(/_/g, " ")}).`), `${n(after.kpis.delayedPax)} passengers remain on ${after.kpis.delayedFlights} delayed flights; ${n(after.kpis.cancelledPax)} cancelled boardings.`]} empty="" />
      <QA q="Why did the dispatcher select this plan?" a={[`Ranked #${a.rank} of ${sim.report.stats.feasible} feasible plans under "${sim.report.objective.split(":")[0]}". ${a.summary}`]} empty="" />
    </div>
  );
}
function QA({ q, a, empty }: { q: string; a: string[]; empty: string }) {
  return <div><div className="text-xs font-semibold">{q}</div><ul className="mt-1 space-y-0.5 text-[11.5px] text-mute">{a.length ? a.map((x, i) => <li key={i}>• {x}</li>) : <li>{empty}</li>}</ul></div>;
}

function MapLegend() {
  return (
    <div className="absolute left-4 top-14 z-10 flex max-w-[calc(100%-2rem)] flex-wrap gap-x-3 gap-y-1 text-[11px] text-mute lg:max-w-[calc(100%-460px)]">
      {[["#65D8EF", "Normal"], ["#F4BA65", "Delayed"], ["#F26E73", "Cancelled / closed"], ["#78E9C4", "Improved"]].map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: c }} />{l}</span>)}
      <span>① ② = highlighted aircraft legs in order · dots = airborne now</span>
    </div>
  );
}

function GuideOverlay({ sim }: { sim: Sim }) {
  const s = sim.scenario;
  const tips = [
    { t: "Closure", d: `${s.airport} is closed ${fmt(s.start)}–${fmt(s.end)}. Aircraft can't take off or land there, so flights wait on the ground.` },
    { t: "Turnaround", d: `After landing, an aircraft needs at least ${sim.net.minTurnaround} minutes on the ground (unload, refuel, board) before its next flight. Lateness travels with the aircraft.` },
    { t: "Connections", d: "Connecting passengers need a minimum time between flights. If the first lands too late, they miss the second." },
    { t: "Crew duty", d: `Crews may work at most ${sim.net.crews[0].maxDuty / 60} hours from duty start. A flight that would break that cannot legally fly.` },
    { t: "Recovery", d: "Holding a flight for connecting passengers, cancelling a round trip, or swapping in a spare aircraft each trades one harm against another. Every option is fully simulated." },
  ];
  return (
    <div className="absolute right-3 top-12 z-20 w-64 space-y-2">
      {tips.map((x) => <div key={x.t} className="rounded-lg border border-amber/50 bg-night/95 p-2.5 text-[11.5px] leading-snug"><span className="font-semibold text-amber">{x.t}. </span>{x.d}</div>)}
    </div>
  );
}

function WhatAmI({ sim }: { sim: Sim }) {
  const ui = useUi();
  const f = ui.selectedFlight ? sim.shown.flightById[ui.selectedFlight] : null;
  const e = ui.selectedEvent ? sim.shown.events.find((x) => x.id === ui.selectedEvent) : null;
  let title = "The control room";
  let body: string[] = [
    "Map (centre): the 16 airports from the dataset at their real coordinates. Lines are scheduled routes; colour shows the computed state of the flights on them. Dots are aircraft in the air at the timeline time.",
    "Timeline (bottom): one row per aircraft. Dashed outlines are the original schedule; filled bars are when each flight actually flies in the simulation. The red band is the closure.",
    "Recovery (right): plans the dispatcher actually simulated, ranked by the objective shown. Apply one to see before/after.",
    "Why it matters: a closure at one airport delays aircraft, and those aircraft carry the delay to other cities on their next flights.",
  ];
  if (f) {
    title = `Flight ${f.flight.id}`;
    body = [
      `This is one scheduled flight from ${f.flight.origin} to ${f.flight.destination}, flown by aircraft ${f.tail} and crew ${f.crewId}, with ${f.flight.pax} passengers booked.`,
      f.status === "on_time" ? "It is unaffected: it leaves at its scheduled time." : f.status === "cancelled" ? "It is cancelled in this simulation. The Flight DNA panel explains the exact rule that stopped it." : `It is ${f.delay} minutes late. The Flight DNA panel shows which earlier flight or closure caused that, step by step.`,
      "How it contributes: anything that happens to this aircraft or crew carries forward to their next flights and to passengers connecting from it.",
    ];
  } else if (e) {
    title = `Ledger event ${e.id}`;
    body = [`A record emitted by the simulation engine: ${e.explanation}`, `Rule applied: ${e.rule}. ${e.parentId ? `It was caused by event ${e.parentId}.` : "It is a root cause."}`];
  } else if (ui.storyOpen) {
    title = "The Domino Story";
    body = ["A guided replay of this exact simulation, in seven scenes. Every sentence comes from the event ledger."];
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-night/60 p-6 sm:items-center" onClick={() => ui.set({ helpOpen: false })}>
      <div className="panel max-w-lg bg-night-2 p-5" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="What am I looking at?">
        <div className="label text-radar">What am I looking at?</div>
        <h3 className="mt-1 font-display text-xl font-semibold">{title}</h3>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-ice/85">{body.map((b, i) => <p key={i}>{b}</p>)}</div>
        <button className="btn mt-4" onClick={() => ui.set({ helpOpen: false })}>Got it</button>
      </div>
    </div>
  );
}
