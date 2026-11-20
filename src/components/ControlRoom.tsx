"use client";
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Clapperboard, HelpCircle, Info, Lightbulb, RotateCcw, Zap } from "lucide-react";
import { fmt, fmtDur, parseHHMM } from "@/engine/time";
import { validateScenario } from "@/engine/simulate";
import type { Kpis } from "@/engine/types";
import { useSim, type Sim } from "@/lib/useSim";
import { useUi } from "@/lib/store";
import { NetworkMap } from "./NetworkMap";
import { Timeline } from "./Timeline";
import { FlightDrawer } from "./FlightDrawer";
import { RecoveryPanel, METRICS, Delta } from "./RecoveryPanel";
import { EventLedger } from "./EventLedger";
import { StoryMode } from "./StoryMode";
import { Intro } from "./Intro";

const n = (x: number) => x.toLocaleString("en-IN");

export function ControlRoom() {
  const sim = useSim();
  const ui = useUi();
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem("ds-intro-seen") === "1"; } catch {}
    if (!seen) ui.set({ introOpen: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const compare = ui.view === "after" && sim.recovered ? sim.disrupted : null;
  const stage = ui.storyOpen ? 0 : ui.appliedId ? 5 : ui.tab === "recovery" ? 4 : ui.selectedFlight ? 3 : 2;
  // Highlighted chain: the selected flight's aircraft, otherwise the longest knock-on chain the engine found.
  const selTail = ui.selectedFlight ? sim.shown.flightById[ui.selectedFlight]?.tail : null;
  const chainTail = selTail ?? sim.story.find((c) => c.key === "cascade" && !c.empty)?.tails[0] ?? null;
  const chainLegs = chainTail ? sim.shown.flights.filter((f) => f.tail === chainTail).sort((a, b) => a.flight.dep - b.flight.dep) : [];

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar sim={sim} stage={stage} />
      <KpiStrip sim={sim} />
      <main className="grid flex-1 grid-cols-1 gap-4 px-4 pb-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[310px_minmax(0,1fr)_390px] xl:px-6">
        <ScenarioPanel sim={sim} />
        <section className="panel relative h-[118vw] max-h-[640px] overflow-hidden lg:max-h-none lg:h-[calc(100vh-200px)] lg:min-h-[560px]" aria-label="Network map">
          <div className="absolute left-4 right-4 top-3 z-10 flex flex-wrap items-center gap-2">
            <span className="label">India network · {sim.net.airports.length} airports · north up</span>
            {sim.recovered && (
              <div className="ml-auto flex rounded-lg bg-night p-0.5 text-xs font-semibold" role="group" aria-label="Before and after">
                {(["before", "after"] as const).map((v) => (
                  <button key={v} onClick={() => ui.set({ view: v })} className={`rounded-md px-2.5 py-1 ${ui.view === v ? (v === "after" ? "bg-mint text-night" : "bg-amber text-night") : "text-mute"}`}>{v === "before" ? "Before" : "After recovery"}</button>
                ))}
              </div>
            )}
          </div>
          <MapLegend />
          <div className="absolute inset-0 px-2 pb-2 pt-14">
            <NetworkMap net={sim.net} result={sim.shown} compare={compare} time={ui.time} selectedFlight={ui.selectedFlight}
              chain={chainLegs.map((f) => f.flight.id)} onSelectFlight={(id) => ui.set({ selectedFlight: id })} revealKey={ui.scenarioKey} />
          </div>
          {chainTail && chainLegs.length > 0 && (
            <div className="absolute bottom-3 right-3 z-10 hidden max-w-[min(360px,60%)] rounded-xl bg-night/90 p-3 text-xs sm:block">
              <div className="label">{selTail ? "Selected aircraft" : "Longest knock-on chain"} · <span className="mono text-ice">{chainTail}</span></div>
              <ol className="mt-1.5 space-y-0.5">
                {chainLegs.map((f, i) => (
                  <li key={f.flight.id}>
                    <button className="mono flex w-full gap-2 text-left hover:text-radar" onClick={() => ui.set({ selectedFlight: f.flight.id, time: f.actualDep ?? f.flight.dep })}>
                      <span className="w-4 text-mute">{i + 1}</span><span className="w-14 font-semibold">{f.flight.id}</span><span className="w-20 text-mute">{f.flight.origin}→{f.flight.destination}</span>
                      <span className={`ml-auto ${f.status === "cancelled" ? "text-coral" : f.delay ? "text-amber" : "text-mint"}`}>{f.status === "cancelled" ? "CXL" : f.delay ? `+${f.delay}m` : "on time"}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {ui.guide && <GuideOverlay sim={sim} />}
        </section>
        <aside className="relative flex min-h-[560px] flex-col lg:col-span-2 xl:col-span-1 xl:h-[calc(100vh-200px)]">
          <div className="panel flex min-h-0 flex-1 flex-col p-4">
            <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-night p-1 text-[13px] font-semibold" role="tablist">
              {([["recovery", "Recovery"], ["ledger", "Event Ledger"], ["flights", "Flights"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={ui.tab === k} onClick={() => ui.set({ tab: k })} className={`rounded-md py-1.5 ${ui.tab === k ? "bg-night-3 text-radar" : "text-mute hover:text-ice"}`}>{l}</button>
              ))}
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
              {ui.tab === "recovery" && <><RecoveryPanel sim={sim} />{sim.applied && <BeforeAfter sim={sim} />}</>}
              {ui.tab === "ledger" && <EventLedger result={sim.shown} />}
              {ui.tab === "flights" && <FlightList sim={sim} />}
            </div>
          </div>
          <FlightDrawer net={sim.net} result={sim.shown} compare={compare} />
        </aside>
        <div className="h-[600px] lg:col-span-2 xl:col-span-3"><Timeline net={sim.net} result={sim.shown} compare={compare} /></div>
      </main>
      <footer className="px-4 pb-4 text-[11px] text-mute">
        Deterministic what-if model of the organisers&apos; single-day dataset (all times IST). Not a live flight network. Every number is computed by the simulation engine; AI text, when enabled, only explains engine-verified candidates.
      </footer>
      {ui.storyOpen && <StoryMode sim={sim} />}
      {ui.introOpen && <Intro sim={sim} />}
      {ui.helpOpen && <WhatAmI sim={sim} />}
    </div>
  );
}

function TopBar({ sim, stage }: { sim: Sim; stage: number }) {
  const ui = useUi();
  const s = sim.scenario;
  const stages = ["Create the storm", "Watch the dominoes", "Understand why", "Recover", "See the difference"];
  return (
    <header className="flex flex-wrap items-center gap-4 px-4 py-4 xl:px-6">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-lg font-bold tracking-[0.08em]">DOMINO SKY</span>
        <span className="font-display text-lg font-bold tracking-[0.08em] text-radar">/ CONTROL</span>
        <span className="hidden text-xs text-mute lg:inline">Predict the ripple. Break the chain.</span>
      </div>
      <ol className="hidden items-center gap-1 text-[11px] md:flex" aria-label="Stages">
        {stages.map((l, i) => (
          <li key={l} className={`rounded-full border px-2 py-0.5 ${i + 1 <= stage ? "border-radar/60 text-radar" : "border-line text-mute"}`}><span className="mono">0{i + 1}</span> {l}</li>
        ))}
      </ol>
      <div className="ml-auto flex items-center gap-2">
        <span className="mono hidden rounded-md border border-line px-2 py-1 text-xs lg:inline">{s.airport} closed {fmt(s.start)}–{fmt(s.end)} · {sim.applied ? (ui.view === "after" ? "recovery applied" : "showing before") : "disruption simulated"}</span>
        <button className="btn btn-primary" onClick={() => ui.set({ storyOpen: true, storyIndex: 0 })}><Clapperboard size={14} />Domino Story</button>
        <button className={`btn ${ui.guide ? "border-amber text-amber" : ""}`} onClick={() => ui.set({ guide: !ui.guide })} aria-pressed={ui.guide}><Lightbulb size={14} /><span className="hidden sm:inline">Guide me</span></button>
        <button className="btn" onClick={() => ui.set({ helpOpen: true })}><HelpCircle size={14} /><span className="hidden sm:inline">What am I looking at?</span><span className="sr-only sm:hidden">What am I looking at?</span></button>
        <button className="btn" onClick={() => ui.reset()} aria-label="Reset to default scenario"><RotateCcw size={14} /><span className="hidden sm:inline">Reset</span></button>
      </div>
    </header>
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
  return (
    <div className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-5 xl:px-6">
      {items.map((it) => (
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
    <section className="panel flex flex-col gap-4 p-5 lg:row-span-1 xl:h-[calc(100vh-200px)] xl:overflow-y-auto scroll-thin" aria-label="Scenario controls">
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
        <Zap size={15} />Simulate Disruption
      </button>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {[["BOM", "08:00", 90], ["BLR", "12:00", 120], ["DEL", "15:00", 90], ["CCU", "18:00", 90], ["HYD", "11:00", 120]].map(([a, t, d]) => (
          <button key={`${a}${t}`} className="chip hover:border-radar" onClick={() => { ui.set({ airport: a as string, start: parseHHMM(t as string), duration: d as number }); setTimeout(() => useUi.getState().simulate(), 0); }}>{a} {t} · {fmtDur(d as number)}</button>
        ))}
      </div>
      {dirty && <p className="text-[11px] text-amber">Inputs changed — press Simulate Disruption to recompute.</p>}
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

function FlightList({ sim }: { sim: Sim }) {
  const ui = useUi();
  const [all, setAll] = useState(false);
  const compare = ui.view === "after" && sim.recovered ? sim.disrupted : null;
  const rows = sim.shown.flights.filter((f) => all || f.status !== "on_time" || (compare && compare.flightById[f.flight.id].status !== "on_time"))
    .sort((a, b) => a.flight.dep - b.flight.dep);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs"><span className="text-mute">{all ? `All ${sim.shown.flights.length} flights` : `${rows.length} affected flights`}</span>
        <button className="text-radar hover:underline" onClick={() => setAll(!all)}>{all ? "Show affected only" : "Show all 70"}</button></div>
      {rows.map((f) => {
        const b = compare?.flightById[f.flight.id];
        return (
          <button key={f.flight.id} onClick={() => ui.set({ selectedFlight: f.flight.id, time: f.actualDep ?? f.flight.dep })} className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-xs hover:border-radar/60">
            <span className="h-2 w-2 rounded-full" style={{ background: f.status === "cancelled" ? "#F26E73" : f.status === "delayed" ? "#F4BA65" : b && b.status !== "on_time" ? "#78E9C4" : "#65D8EF" }} />
            <span className="mono w-14 font-semibold">{f.flight.id}</span>
            <span className="mono w-20 text-mute">{f.flight.origin}→{f.flight.destination}</span>
            <span className="mono text-mute">{fmt(f.flight.dep)}</span>
            <span className="mono ml-auto">{f.status === "cancelled" ? <span className="text-coral">CXL</span> : f.delay ? <span className="text-amber">+{f.delay}m</span> : <span className="text-mint">on time</span>}</span>
          </button>
        );
      })}
    </div>
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
    <div className="absolute left-4 top-9 z-10 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mute">
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
