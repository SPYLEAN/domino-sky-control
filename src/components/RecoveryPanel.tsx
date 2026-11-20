"use client";
import { useState } from "react";
import { Bot, Check, ChevronDown, ShieldCheck, X } from "lucide-react";
import { STRATEGIES, type Candidate, type Strategy } from "@/engine/recovery";
import type { Kpis } from "@/engine/types";
import type { Sim } from "@/lib/useSim";
import { useUi } from "@/lib/store";

const n = (x: number) => x.toLocaleString("en-IN");
const METRICS: { k: keyof Kpis; label: string; unit?: string }[] = [
  { k: "cancelledPax", label: "Cancelled boardings" },
  { k: "missedConnectionPax", label: "Missed-connection pax" },
  { k: "paxDelayMinutes", label: "Passenger-delay min" },
  { k: "totalFlightDelay", label: "Flight-delay min" },
  { k: "cancelledFlights", label: "Cancelled flights" },
  { k: "crewDutyAlerts", label: "Crew duty cancellations" },
];

function Delta({ v }: { v: number | undefined }) {
  if (v === undefined || v === 0) return <span className="text-mute">±0</span>;
  return <span className={v < 0 ? "text-mint" : "text-coral"}>{v > 0 ? "+" : ""}{n(v)}</span>;
}

export function RecoveryPanel({ sim }: { sim: Sim }) {
  const { report } = sim;
  const { appliedId, strategy, set } = useUi();
  const [journalOpen, setJournalOpen] = useState(false);
  const shortlist = report.ranked.filter((c) => !c.sameOutcomeAs || c.id === "C-NONE").slice(0, 5);
  if (!shortlist.includes(report.noneCandidate)) shortlist.push(report.noneCandidate);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between"><span className="label">Dispatcher objective</span>
          <select className="rounded-md border border-line bg-night px-2 py-1 text-xs" value={strategy} onChange={(e) => set({ strategy: e.target.value as Strategy, appliedId: null, view: "before" })}>
            {(Object.keys(STRATEGIES) as Strategy[]).map((s) => <option key={s} value={s}>{STRATEGIES[s].label}</option>)}
          </select>
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-mute">{STRATEGIES[strategy].description}</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[["Considered", report.stats.generated], ["Simulated", report.stats.simulated], ["Feasible", report.stats.feasible], ["Improve", report.stats.improving]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-night px-1 py-1.5"><div className="mono text-base font-semibold">{v}</div><div className="text-[10px] text-mute">{k}</div></div>
        ))}
      </div>
      <p className="text-[11px] text-mute">Best evaluated recovery under the displayed search scope — not a proof of global optimality.</p>

      {shortlist.map((c) => <CandidateCard key={c.id} c={c} winner={c.id === report.winner.id} applied={appliedId === c.id} />)}

      <AiDispatcher sim={sim} />

      <div className="rounded-xl border border-line">
        <button className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold" onClick={() => setJournalOpen(!journalOpen)} aria-expanded={journalOpen}>
          Recovery Decision Journal <ChevronDown size={14} className={journalOpen ? "rotate-180" : ""} />
        </button>
        {journalOpen && (
          <div className="space-y-2 border-t border-line p-3 text-xs">
            <p className="text-mute">{report.scope}</p>
            <div className="label">Rejected before or after simulation</div>
            {report.rejectionSummary.length ? report.rejectionSummary.map((r) => <div key={r.reason} className="flex justify-between gap-2"><span>{r.reason}</span><span className="mono text-coral">{r.count}</span></div>) : <p className="text-mute">None.</p>}
            {report.candidates.filter((c) => !c.feasible).slice(0, 4).map((c) => (
              <div key={c.id} className="rounded-md bg-night p-2"><div className="font-semibold">{c.title}</div><div className="text-coral">{c.rejection}</div></div>
            ))}
            <div className="label pt-1">Journal ({report.journal.length} entries)</div>
            <ol className="scroll-thin max-h-56 space-y-1 overflow-y-auto">
              {report.journal.map((j) => <li key={j.seq} className="mono text-[10.5px] text-mute"><span className="text-radar">{String(j.seq).padStart(3, "0")} {j.type}</span> {j.text}</li>)}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateCard({ c, winner, applied }: { c: Candidate; winner: boolean; applied: boolean }) {
  const set = useUi((s) => s.set);
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-xl border p-3 transition ${applied ? "border-mint bg-mint/5" : winner ? "border-radar/70" : "border-line"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="mono text-mute">#{c.rank}</span>
            {winner && <span className="chip border-radar text-radar">Recommended</span>}
            {c.improves ? <span className="chip border-mint/60 text-mint">Improves</span> : c.actions.length ? <span className="chip text-mute">No gain</span> : null}
          </div>
          <div className="mt-1 text-sm font-semibold">{c.title}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-mute">{c.summary}</p>
        </div>
      </div>
      <div className="mono mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        {METRICS.slice(0, 4).map((m) => <div key={m.k} className="flex justify-between"><span className="text-mute">{m.label}</span><Delta v={c.delta[m.k]} /></div>)}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {c.actions.length > 0 && (
          applied
            ? <button className="btn" onClick={() => set({ appliedId: null, view: "before" })}><X size={13} />Remove plan</button>
            : <button className="btn btn-mint" onClick={() => set({ appliedId: c.id, view: "after", selectedFlight: null })}><Check size={13} />Apply plan</button>
        )}
        <button className="text-[11px] text-mute underline-offset-2 hover:text-ice hover:underline" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} feasibility checks</button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1 text-[11px]">
          {c.checks.map((k, i) => <li key={i} className="flex gap-1.5"><ShieldCheck size={12} className={k.passed ? "mt-0.5 text-mint" : "mt-0.5 text-coral"} /><span><span className="mono">{k.rule}</span> — {k.detail}</span></li>)}
          <li className="mono text-mute">id {c.id}</li>
        </ul>
      )}
    </div>
  );
}

interface AiResult { source: "gemini" | "rules"; recommendedCandidateId: string; headline: string; rationale: string; tradeoffs: string[]; note?: string }

function AiDispatcher({ sim }: { sim: Sim }) {
  const committed = useUi((s) => s.committed);
  const strategy = useUi((s) => s.strategy);
  const [state, setState] = useState<{ loading: boolean; data: AiResult | null; key: string }>({ loading: false, data: null, key: "" });
  const key = `${committed.airport}-${committed.start}-${committed.end}-${strategy}`;
  const data = state.key === key ? state.data : null;
  const ask = async () => {
    setState({ loading: true, data: null, key });
    try {
      const res = await fetch("/api/dispatcher", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: committed, strategy }) });
      const j = (await res.json()) as AiResult;
      setState({ loading: false, data: j, key });
    } catch {
      setState({ loading: false, data: null, key });
    }
  };
  const winner = data ? sim.report.ranked.find((c) => c.id === data.recommendedCandidateId) : null;
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-2">
        <Bot size={15} className="text-radar" /><span className="text-sm font-semibold">Dispatcher explanation</span>
        <button className="btn ml-auto py-1 text-xs" onClick={ask} disabled={state.loading}>{state.loading ? "Explaining…" : data ? "Re-ask" : "Explain recommendation"}</button>
      </div>
      {data && (
        <div className="mt-2 space-y-1.5 text-[12.5px]">
          <span className={`chip ${data.source === "gemini" ? "border-radar text-radar" : "text-amber border-amber/50"}`}>{data.source === "gemini" ? "AI wording (Gemini) · numbers from engine" : "Rules-based explanation"}</span>
          {data.note && <p className="text-[11px] text-mute">{data.note}</p>}
          <p className="font-semibold">{data.headline}</p>
          <p className="text-mute">{data.rationale}</p>
          {data.tradeoffs.map((t, i) => <p key={i} className="text-mute">• {t}</p>)}
          {winner && (
            <div className="mono mt-1 grid grid-cols-2 gap-x-3 rounded-lg bg-night p-2 text-[11px]">
              <div className="col-span-2 mb-1 text-mute">Verified engine figures for {winner.id}</div>
              {METRICS.slice(0, 4).map((m) => <div key={m.k} className="flex justify-between"><span className="text-mute">{m.label}</span><span>{n(winner.kpis![m.k])} (<Delta v={winner.delta[m.k]} />)</span></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { METRICS, Delta };
