import { z } from "zod";
import type { Network } from "./types";

/** Structured output the AI dispatcher is allowed to return: candidate selection + qualitative prose only. */
export const AiDispatcherSchema = z.object({
  recommendedCandidateId: z.string(),
  headline: z.string().max(160),
  rationale: z.string().max(900),
  tradeoffs: z.array(z.string().max(300)).max(5),
});
export type AiDispatcherResponse = z.infer<typeof AiDispatcherSchema>;

export type GuardResult = { ok: true; value: AiDispatcherResponse } | { ok: false; reason: string };

/**
 * Validates an AI response. Rejects it when:
 *  - the shape is wrong,
 *  - the selected candidate is not one the engine produced,
 *  - any flight / tail / crew / airport identifier does not exist in the dataset,
 *  - any digit remains after removing verified identifiers (numbers must come from the engine, never the model).
 */
export function sanitizeAiResponse(input: unknown, candidateIds: string[], net: Network): GuardResult {
  const parsed = AiDispatcherSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "Response did not match the required schema." };
  const v = parsed.data;
  if (!candidateIds.includes(v.recommendedCandidateId)) return { ok: false, reason: `Unknown candidate id "${v.recommendedCandidateId}".` };
  const texts = [v.headline, v.rationale, ...v.tradeoffs];
  for (const t of texts) {
    let rest = t;
    for (const id of candidateIds) rest = rest.split(id).join(" ");
    for (const m of rest.match(/\bDS\d{3,4}\b/g) ?? []) if (!net.flightById[m]) return { ok: false, reason: `Invented flight id ${m}.` };
    for (const m of rest.match(/\bVT-DS\d{2}\b/g) ?? []) if (!net.aircraftByTail[m]) return { ok: false, reason: `Invented aircraft ${m}.` };
    for (const m of rest.match(/\bCR\d{2}\b/g) ?? []) if (!net.crewById[m]) return { ok: false, reason: `Invented crew ${m}.` };
    for (const m of rest.match(/\bCX\d{2}\b/g) ?? []) if (!net.connections.some((c) => c.id === m)) return { ok: false, reason: `Invented connection ${m}.` };
    rest = rest.replace(/\bDS\d{4}\b|\bVT-DS\d{2}\b|\bCR\d{2}\b|\bCX\d{2}\b/g, " ");
    if (/\d/.test(rest)) return { ok: false, reason: "Response contained numeric claims; all numbers must come from the deterministic engine." };
  }
  return { ok: true, value: v };
}
