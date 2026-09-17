/**
 * Real AI analysis for a reported challenge.
 *
 * Runs entirely on the server: the model credential is never sent to the
 * browser. Database access uses the caller's own session, so the existing Row
 * Level Security policies decide what can be read and written.
 */

import { createServerFn } from "@tanstack/react-start";
import { callGemini, type AiLanguage } from "@/lib/ai-gateway.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
type Priority = (typeof PRIORITIES)[number];

const THREAT_LEVELS = ["NORMAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
type ThreatLevel = (typeof THREAT_LEVELS)[number];

const SERVICES = [
  "PRIMARY",
  "POLICE",
  "FIRE",
  "AMBULANCE",
  "DISASTER_MANAGEMENT",
  "ROAD_ACCIDENT",
  "LPG_LEAK",
  "CYBER_CRIME",
  "WOMEN_HELPLINE",
  "CHILD_HELPLINE",
  "NONE",
] as const;

const EMERGENCY_CATEGORIES = [
  "FIRE",
  "MEDICAL",
  "ACCIDENT",
  "GAS_LEAK",
  "FLOOD",
  "INFRASTRUCTURE_FAILURE",
  "ELECTRICAL",
  "HAZMAT",
  "PUBLIC_SAFETY",
  "NATURAL_DISASTER",
  "CIVIC_ISSUE",
] as const;

export interface ChallengeAiAnalysis {
  category: string;
  priority: Priority;
  confidence: number;
  estimatedImpact: number | null;
  summary: string;
  recommendedSkills: string[];
  affectedStakeholders: string[];
  solutionDirections: string[];
  /** Advisory threat assessment — never a confirmed emergency. */
  threatLevel: ThreatLevel;
  threatCategory: string;
  threatReason: string;
  recommendedService: string;
  emergencyStatus: string;
  reportedLocation: string | null;
  latitude: number | null;
  longitude: number | null;
}


/** Message shown to the citizen when analysis could not be completed. */
export class AnalysisUnavailableError extends Error {
  constructor() {
    super(
      "Your challenge was saved, but AI analysis could not be completed. You can retry.",
    );
    this.name = "AnalysisUnavailableError";
  }
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, max);
}

function parseAnalysis(raw: string): ChallengeAiAnalysis {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("model returned no JSON object");

  const parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;

  const category = typeof parsed["category"] === "string" ? parsed["category"].trim() : "";
  const priority = String(parsed["priority"] ?? "").toUpperCase() as Priority;
  const confidence = Number(parsed["confidence"]);
  const summary = typeof parsed["summary"] === "string" ? parsed["summary"].trim() : "";
  const impactRaw = parsed["estimated_impact"];
  const estimatedImpact =
    impactRaw === null || impactRaw === undefined || impactRaw === ""
      ? null
      : Number.isFinite(Number(impactRaw))
        ? Math.max(0, Math.round(Number(impactRaw)))
        : null;

  const recommendedSkills = stringList(parsed["recommended_skills"], 8);
  const affectedStakeholders = stringList(parsed["affected_stakeholders"], 8);
  const solutionDirections = stringList(parsed["solution_directions"], 8);

  const threatLevelRaw = String(parsed["threat_level"] ?? "NORMAL").toUpperCase();
  const threatLevel = (THREAT_LEVELS as readonly string[]).includes(threatLevelRaw)
    ? (threatLevelRaw as ThreatLevel)
    : "NORMAL";

  const threatCategoryRaw = String(parsed["threat_category"] ?? "CIVIC_ISSUE").toUpperCase();
  const threatCategory = (EMERGENCY_CATEGORIES as readonly string[]).includes(threatCategoryRaw)
    ? threatCategoryRaw
    : "CIVIC_ISSUE";

  const serviceRaw = String(parsed["recommended_service"] ?? "NONE").toUpperCase();
  const recommendedService = (SERVICES as readonly string[]).includes(serviceRaw)
    ? serviceRaw
    : "NONE";

  const threatReason =
    typeof parsed["threat_reason"] === "string" ? parsed["threat_reason"].trim() : "";

  // Advisory only: a person still has to confirm before any call is placed.
  const emergencyStatus =
    threatLevel === "CRITICAL"
      ? "POTENTIAL_EMERGENCY"
      : threatLevel === "HIGH"
        ? "HIGH_PRIORITY"
        : "NORMAL";

  if (!category) throw new Error("missing category");
  if (!PRIORITIES.includes(priority)) throw new Error(`invalid priority: ${priority}`);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    throw new Error("confidence out of range");
  if (summary.length < 10) throw new Error("summary too short");
  if (recommendedSkills.length === 0) throw new Error("no recommended skills");

  return {
    category,
    priority,
    confidence,
    estimatedImpact,
    summary,
    recommendedSkills,
    affectedStakeholders,
    solutionDirections,
    threatLevel,
    threatCategory,
    threatReason,
    recommendedService,
    emergencyStatus,
    reportedLocation: null,
    latitude: null,
    longitude: null,
  };
}

const SYSTEM_PROMPT = `You are CivicX Intelligence, an analyst that triages civic challenges reported by citizens.
Analyse the report and respond with ONLY a JSON object, no prose and no code fences, in exactly this shape:
{
  "category": "string",
  "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "confidence": number between 0 and 1,
  "estimated_impact": integer or null,
  "summary": "2-3 sentence explanation of the civic challenge",
  "recommended_skills": ["string", ...],
  "affected_stakeholders": ["string", ...],
  "solution_directions": ["string", ...],
  "threat_level": "NORMAL" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "threat_category": "FIRE" | "MEDICAL" | "ACCIDENT" | "GAS_LEAK" | "FLOOD" | "INFRASTRUCTURE_FAILURE" | "ELECTRICAL" | "HAZMAT" | "PUBLIC_SAFETY" | "NATURAL_DISASTER" | "CIVIC_ISSUE",
  "threat_reason": "one or two sentences explaining the threat judgement, with explicit uncertainty when the report is vague",
  "recommended_service": "PRIMARY" | "POLICE" | "FIRE" | "AMBULANCE" | "DISASTER_MANAGEMENT" | "ROAD_ACCIDENT" | "LPG_LEAK" | "CYBER_CRIME" | "WOMEN_HELPLINE" | "CHILD_HELPLINE" | "NONE"
}
Rules:
- Never invent precise real-world statistics. "estimated_impact" is a rough AI estimate of the total number of PEOPLE affected (a whole head-count, never a score or rating); if the report does not support any estimate, use null.
- Word the summary so it is clear the assessment is an AI estimate, not verified fact.
- Base everything strictly on the citizen's report; do not claim to have detected duplicate reports or consulted external data.
- Give 3-5 recommended skills, 2-4 affected stakeholders and 2-4 solution directions.
Threat assessment rules (safety critical):
- You are advisory only. NEVER state that an emergency is confirmed, that authorities were contacted, or that help is on the way. Use wording such as "possible" or "potential".
- Use "threat_level": "CRITICAL" only when the report describes an active, immediate danger to human life or property right now (active fire, people trapped, serious injuries, gas leak, collapse, live electrical hazard, severe flooding, hazardous material release, immediate violence).
- Ordinary civic issues (potholes, garbage, broken streetlights, minor waterlogging, long-standing neglect) are NEVER emergencies: use "threat_level": "NORMAL" or "LOW", "threat_category": "CIVIC_ISSUE" and "recommended_service": "NONE".
- When the report is vague or ambiguous (for example an unidentified smell), do not claim an emergency: use at most "MEDIUM" or "HIGH", say plainly in "threat_reason" that the report is unverified and inconclusive, and recommend a cautious service only if a real hazard is plausible.
- "recommended_service" must be "PRIMARY" (112) whenever multiple services or immediate life safety are involved.`;


const readLanguage = (value: unknown): AiLanguage => (value === "hi" ? "hi" : "en");

async function callModel(prompt: string, language: AiLanguage): Promise<string> {
  try {
    return await callGemini({ feature: "analysis", system: SYSTEM_PROMPT, prompt, language });
  } catch {
    throw new AnalysisUnavailableError();
  }
}

/**
 * Analyse a challenge the caller owns and store the structured result.
 * The challenge row is never deleted or duplicated — only updated.
 */
export const analyzeChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { challengeId: string; language?: string }) => {
    const id = String(input?.challengeId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("A valid challenge id is required.");
    return { challengeId: id, language: readLanguage(input?.language) };
  })
  .handler(async ({ data, context }): Promise<ChallengeAiAnalysis> => {
    const { supabase, userId } = context;

    const { data: challenge, error } = await supabase
      .from("challenges")
      .select(
        "id, created_by, title, description, category, location_name, latitude, longitude",
      )
      .eq("id", data.challengeId)
      .maybeSingle();

    if (error) {
      console.error("[civicx] challenge lookup failed", error);
      throw new AnalysisUnavailableError();
    }
    if (!challenge) throw new Error("This challenge could not be found.");
    if (challenge.created_by !== userId)
      throw new Error("You can only analyse challenges you reported.");

    await supabase
      .from("challenges")
      .update({ status: "AI_ANALYSIS" })
      .eq("id", challenge.id);
    await supabase.from("challenge_status_history").insert({
      challenge_id: challenge.id,
      status: "AI_ANALYSIS",
      message: "AI analysis started",
    });

    const prompt = [
      `Title: ${challenge.title}`,
      `Description: ${challenge.description}`,
      `Citizen-selected category: ${challenge.category ?? "not provided"}`,
      `Location: ${challenge.location_name ?? "not provided"}`,
      `Latitude: ${challenge.latitude ?? "not provided"}`,
      `Longitude: ${challenge.longitude ?? "not provided"}`,
    ].join("\n");

    let analysis: ChallengeAiAnalysis;
    try {
      analysis = parseAnalysis(await callModel(prompt, data.language));
    } catch (err) {
      console.error("[civicx] AI analysis failed", err);
      await supabase
        .from("challenges")
        .update({ status: "AI_ANALYSIS_FAILED" })
        .eq("id", challenge.id);
      await supabase.from("challenge_status_history").insert({
        challenge_id: challenge.id,
        status: "AI_ANALYSIS_FAILED",
        message: "AI analysis could not be completed. The report is saved and can be retried.",
      });
      throw new AnalysisUnavailableError();
    }

    // Escalation status stays advisory: only a person confirming the call
    // action can move a report to EMERGENCY_ESCALATION_INITIATED.
    const { error: updateError } = await supabase
      .from("challenges")
      .update({
        category: analysis.category,
        priority: analysis.priority,
        ai_confidence: Math.round(analysis.confidence * 100),
        estimated_impact: analysis.estimatedImpact,
        ai_summary: analysis.summary,
        recommended_skills: analysis.recommendedSkills,
        affected_stakeholders: analysis.affectedStakeholders,
        solution_directions: analysis.solutionDirections,
        threat_level: analysis.threatLevel,
        threat_category: analysis.threatCategory,
        threat_reason: analysis.threatReason,
        recommended_service: analysis.recommendedService,
        emergency_status: analysis.emergencyStatus,
        status: "AI_ANALYSIS_COMPLETE",
      })
      .eq("id", challenge.id);

    if (updateError) {
      console.error("[civicx] storing analysis failed", updateError);
      throw new AnalysisUnavailableError();
    }

    await supabase.from("challenge_status_history").insert({
      challenge_id: challenge.id,
      status: "AI_ANALYSIS_COMPLETE",
      message: "AI analysis completed successfully",
    });

    if (analysis.emergencyStatus === "POTENTIAL_EMERGENCY") {
      await supabase.from("challenge_status_history").insert({
        challenge_id: challenge.id,
        status: "POTENTIAL_EMERGENCY",
        message:
          "AI threat analysis flagged a potential emergency. Advisory only — no authority has been contacted.",
      });
    }

    return {
      ...analysis,
      reportedLocation: challenge.location_name,
      latitude: challenge.latitude,
      longitude: challenge.longitude,
    };
  });

