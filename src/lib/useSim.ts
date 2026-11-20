"use client";
import { useMemo } from "react";
import { getNetwork } from "@/engine/data";
import { runRecovery } from "@/engine/recovery";
import { buildStory } from "@/engine/story";
import { simulate } from "@/engine/simulate";
import { useUi } from "./store";

/** Derives every displayed number from the deterministic engine. UI state never feeds back into results. */
export function useSim() {
  const net = getNetwork();
  const committed = useUi((s) => s.committed);
  const strategy = useUi((s) => s.strategy);
  const appliedId = useUi((s) => s.appliedId);
  const view = useUi((s) => s.view);

  const scenario = useMemo(() => ({ airport: committed.airport, start: committed.start, end: committed.end }), [committed]);
  const baselineDay = useMemo(() => simulate(net, null), [net]);
  const report = useMemo(() => runRecovery(net, scenario, strategy), [net, scenario, strategy]);
  const disrupted = report.baseline;
  const applied = appliedId ? report.candidates.find((c) => c.id === appliedId) ?? null : null;
  const recovered = applied?.result ?? null;
  const shown = view === "after" && recovered ? recovered : disrupted;
  const story = useMemo(() => buildStory(net, disrupted, report, appliedId), [net, disrupted, report, appliedId]);
  return { net, scenario, baselineDay, report, disrupted, applied, recovered, shown, story };
}

export type Sim = ReturnType<typeof useSim>;
