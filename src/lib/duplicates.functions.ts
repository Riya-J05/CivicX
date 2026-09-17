/**
 * AI-assisted duplicate detection for civic challenges.
 *
 * Two stages, both server-side:
 *   1. candidate retrieval + deterministic similarity scoring (text, category,
 *      geographic proximity, keywords, status)
 *   2. the existing Gemini infrastructure classifies each shortlisted pair.
 *
 * Results are advisory only. No report is ever deleted, merged or hidden: the
 * relationship is recorded in `challenge_duplicates` and the citizen decides.
 */

import { createServerFn } from "@tanstack/react-start";
import { callGemini, type AiLanguage } from "@/lib/ai-gateway.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


const CLASSIFICATIONS = ["SAME_ISSUE", "POSSIBLE_DUPLICATE", "DIFFERENT_ISSUE"] as const;
export type DuplicateClassification = (typeof CLASSIFICATIONS)[number];

export interface DuplicateMatch {
  /** Row id in `challenge_duplicates`. */
  relationshipId: string;
  challengeId: string;
  title: string;
  category: string | null;
  priority: string;
  status: string;
  locationName: string | null;
  distanceM: number | null;
  reportCount: number;
  aiSummary: string | null;
  similarity: number;
  classification: DuplicateClassification;
  confidence: number;
  reason: string;
  recommendedAction: string;
  linked: boolean;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "near", "is", "are",
  "was", "were", "to", "for", "with", "by", "from", "this", "that", "there",
  "it", "as", "be", "has", "have", "not", "no", "very", "big", "large", "small",
  "please", "issue", "problem", "area", "since", "days", "here",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  a.forEach((t) => {
    if (b.has(t)) shared += 1;
  });
  return shared / (a.size + b.size - shared);
}

/** Distance factor: nearby reports score high, distant ones are penalised hard. */
function proximityFactor(distanceM: number | null): number {
  if (distanceM === null) return 0.45; // unknown location — never a strong signal
  if (distanceM <= 150) return 1;
  if (distanceM <= 500) return 0.85;
  if (distanceM <= 1500) return 0.6;
  if (distanceM <= 3000) return 0.35;
  return 0.1;
}

interface Candidate {
  id: string;
  title: string;
  description: string;
  category: string | null;
  priority: string;
  status: string;
  location_name: string | null;
  city: string | null;
  locality: string | null;
  latitude: number | null;
  longitude: number | null;
  ai_summary: string | null;
  report_count: number;
  created_at: string;
  distance_m: number | null;
}

const SYSTEM_PROMPT = `You are CivicX Intelligence performing advisory duplicate detection on civic challenge reports.
For each candidate pair, decide whether the NEW report describes the SAME underlying civic problem as the EXISTING report.
Respond with ONLY a JSON array, no prose and no code fences:
[{"candidate_id":"uuid","classification":"SAME_ISSUE"|"POSSIBLE_DUPLICATE"|"DIFFERENT_ISSUE","confidence":number between 0 and 1,"reason":"one short sentence a citizen can read","recommended_action":"LINK_TO_EXISTING"|"REVIEW"|"KEEP_SEPARATE"}]
Rules:
- Location matters as much as wording. Similar wording at clearly different places (different locality, or more than a few hundred metres apart) is NOT the same issue.
- Different problem types at the same place (garbage vs waterlogging) are DIFFERENT_ISSUE.
- Use SAME_ISSUE only when the same problem at effectively the same place is described.
- You are advisory. Never state certainty; phrase the reason as a likelihood.
- Include exactly one object per candidate, using the candidate_id given.`;

const readLanguage = (value: unknown): AiLanguage => (value === "hi" ? "hi" : "en");

async function classify(prompt: string, language: AiLanguage): Promise<unknown> {
  const content = await callGemini({
    feature: "duplicates",
    system: SYSTEM_PROMPT,
    prompt,
    language,
  });

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? content).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("model returned no JSON array");
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Detect possible duplicates for a challenge the caller reported.
 * Returns an advisory, human-readable shortlist; never mutates the report text.
 */
export const detectDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { challengeId: string; language?: string }) => {
    const id = String(input?.challengeId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("A valid challenge id is required.");
    return { challengeId: id, language: readLanguage(input?.language) };
  })
  .handler(async ({ data, context }): Promise<DuplicateMatch[]> => {
    const { supabase, userId } = context;

    const { data: mine, error } = await supabase
      .from("challenges")
      .select("id, created_by, title, description, category, location_name, locality, city, ai_summary")
      .eq("id", data.challengeId)
      .maybeSingle();

    if (error || !mine) {
      console.error("[civicx] duplicate lookup: challenge not readable", error);
      return [];
    }
    if (mine.created_by !== userId) return [];

    const { data: candidateRows, error: rpcError } = await supabase.rpc(
      "find_duplicate_candidates",
      { _challenge_id: data.challengeId, _radius_m: 3000, _limit: 12 },
    );
    if (rpcError) {
      console.error("[civicx] candidate retrieval failed", rpcError);
      return [];
    }

    const candidates = (candidateRows ?? []) as Candidate[];
    if (candidates.length === 0) return [];

    /* ---- stage 1: deterministic similarity ---- */
    const mineTokens = tokens(`${mine.title} ${mine.description} ${mine.ai_summary ?? ""}`);
    const mineCategory = (mine.category ?? "").trim().toLowerCase();
    const minePlace = (mine.locality ?? mine.city ?? "").trim().toLowerCase();

    const scored = candidates
      .map((c) => {
        const text = jaccard(
          mineTokens,
          tokens(`${c.title} ${c.description} ${c.ai_summary ?? ""}`),
        );
        const sameCategory =
          mineCategory && (c.category ?? "").trim().toLowerCase() === mineCategory ? 1 : 0;
        const samePlace =
          minePlace && (c.locality ?? c.city ?? "").trim().toLowerCase() === minePlace ? 1 : 0;
        const openStatus = c.status === "IMPACT" || c.status === "RESOLVED" ? 0 : 1;
        const proximity = proximityFactor(c.distance_m);

        const similarity =
          (0.45 * text + 0.15 * sameCategory + 0.1 * samePlace + 0.05 * openStatus) *
            0.7 +
          0.3 * proximity * (0.3 + 0.7 * text);

        return { candidate: c, similarity: Math.min(1, Math.max(0, similarity)) };
      })
      .filter((s) => s.similarity >= 0.12)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    if (scored.length === 0) return [];

    /* ---- stage 2: Gemini classification ---- */
    const prompt = [
      "NEW REPORT",
      `Title: ${mine.title}`,
      `Description: ${mine.description}`,
      `Category: ${mine.category ?? "not provided"}`,
      `Location: ${mine.location_name ?? "not provided"}`,
      "",
      "CANDIDATES",
      ...scored.map(({ candidate: c, similarity }) =>
        [
          `candidate_id: ${c.id}`,
          `Title: ${c.title}`,
          `Description: ${c.description}`,
          `Category: ${c.category ?? "not provided"}`,
          `Location: ${c.location_name ?? "not provided"}`,
          `Distance from new report: ${c.distance_m === null ? "unknown" : `${Math.round(c.distance_m)} m`}`,
          `Pre-computed similarity: ${similarity.toFixed(2)}`,
          "",
        ].join("\n"),
      ),
    ].join("\n");

    let verdicts: Array<Record<string, unknown>> = [];
    try {
      const parsed = await classify(prompt, data.language);
      verdicts = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
    } catch (err) {
      console.error("[civicx] duplicate classification failed", err);
      return [];
    }

    const matches: DuplicateMatch[] = [];

    for (const { candidate, similarity } of scored) {
      const verdict = verdicts.find((v) => String(v["candidate_id"] ?? "") === candidate.id);
      if (!verdict) continue;

      const raw = String(verdict["classification"] ?? "").toUpperCase();
      const classification = (CLASSIFICATIONS as readonly string[]).includes(raw)
        ? (raw as DuplicateClassification)
        : "POSSIBLE_DUPLICATE";
      if (classification === "DIFFERENT_ISSUE") continue;

      const confidenceRaw = Number(verdict["confidence"]);
      const confidence =
        Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 1
          ? confidenceRaw
          : 0.5;
      const reason =
        typeof verdict["reason"] === "string" && verdict["reason"].trim().length > 0
          ? verdict["reason"].trim()
          : "The wording and location of both reports look related.";
      const action = String(verdict["recommended_action"] ?? "REVIEW").toUpperCase();

      // Only a strong same-issue verdict is proposed as a link; the citizen can
      // always keep their report separate.
      const upsert = await supabase
        .from("challenge_duplicates")
        .upsert(
          {
            challenge_id: candidate.id,
            possible_duplicate_id: data.challengeId,
            similarity_score: Number(similarity.toFixed(3)),
            ai_classification: classification,
            ai_confidence: Number(confidence.toFixed(2)),
            ai_reason: reason,
            ai_recommended_action: action,
            distance_m: candidate.distance_m,
            status: "PENDING",
          },
          { onConflict: "challenge_id,possible_duplicate_id" },
        )
        .select("id, status")
        .single();

      if (upsert.error) {
        console.error("[civicx] recording duplicate relationship failed", upsert.error);
        continue;
      }

      matches.push({
        relationshipId: upsert.data.id,
        challengeId: candidate.id,
        title: candidate.title,
        category: candidate.category,
        priority: candidate.priority,
        status: candidate.status,
        locationName: candidate.location_name,
        distanceM: candidate.distance_m,
        reportCount: candidate.report_count ?? 1,
        aiSummary: candidate.ai_summary,
        similarity: Number(similarity.toFixed(2)),
        classification,
        confidence: Math.round(confidence * 100),
        reason,
        recommendedAction: action,
        linked: upsert.data.status === "LINKED",
      });
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  });
