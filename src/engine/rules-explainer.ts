import type { RecoveryReport } from "./recovery";
import type { AiDispatcherResponse } from "./ai-guard";

/** Deterministic, rules-based recommendation text. Used when no AI is configured or the AI response is rejected. */
export function rulesExplanation(rep: RecoveryReport): AiDispatcherResponse {
  const w = rep.winner;
  const d = w.delta;
  const n = (x: number | undefined) => (x ?? 0).toLocaleString("en-IN");
  if (w.actions.length === 0) {
    return {
      recommendedCandidateId: w.id,
      headline: "Keep the disrupted schedule — no evaluated plan does better.",
      rationale: `The dispatcher simulated ${rep.stats.simulated} plans. Under "${rep.objective.split(":")[0]}" none reduced passenger harm compared with leaving the schedule alone, so intervening would only add complexity.`,
      tradeoffs: ["Delays computed for the disruption remain in place.", "No passengers are deliberately sacrificed."],
    };
  }
  const tradeoffs: string[] = [];
  if ((d.missedConnectionPax ?? 0) < 0) tradeoffs.push(`Protects ${n(-d.missedConnectionPax!)} connecting passengers.`);
  if ((d.cancelledPax ?? 0) < 0) tradeoffs.push(`Saves ${n(-d.cancelledPax!)} booked boardings from cancellation.`);
  if ((d.cancelledPax ?? 0) > 0) tradeoffs.push(`Sacrifices ${n(d.cancelledPax)} booked boardings through cancellation.`);
  if ((d.paxDelayMinutes ?? 0) > 0) tradeoffs.push(`Adds ${n(d.paxDelayMinutes)} passenger-minutes of delay to other travellers.`);
  if ((d.paxDelayMinutes ?? 0) < 0) tradeoffs.push(`Removes ${n(-d.paxDelayMinutes!)} passenger-minutes of delay.`);
  const runner = rep.ranked.find((c) => c.id !== w.id && !c.sameOutcomeAs && c.actions.length);
  return {
    recommendedCandidateId: w.id,
    headline: `${w.title}.`,
    rationale: `${w.summary} It ranked first of ${rep.stats.feasible} feasible plans under the objective. ${runner ? `The runner-up, "${runner.title}", scored worse on the objective's earlier priorities.` : ""}`.trim(),
    tradeoffs,
  };
}
