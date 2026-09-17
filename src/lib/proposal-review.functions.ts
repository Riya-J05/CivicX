/**
 * Real AI feasibility review of a submitted solution proposal.
 *
 * Runs entirely on the server so the model credential never reaches the
 * browser. Database access uses the caller's own session, so the existing Row
 * Level Security policies and triggers decide what may be read and written.
 * An existing review is returned as-is — the model is never re-run just
 * because a page was opened.
 */

import { createServerFn } from "@tanstack/react-start";
import { callGemini, type AiLanguage } from "@/lib/ai-gateway.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


const RATINGS = ["LOW", "MEDIUM", "HIGH"] as const;
type Rating = (typeof RATINGS)[number];

export interface ProposalAiReview {
  technicalFeasibility: Rating;
  impactPotential: Rating;
  implementationComplexity: Rating;
  skillAlignment: Rating;
  assessment: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  nextStep: string;
}

export class ReviewUnavailableError extends Error {
  constructor() {
    super(
      "Your proposal was submitted, but the AI feasibility review could not be completed. You can retry.",
    );
    this.name = "ReviewUnavailableError";
  }
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, max);
}

function rating(value: unknown, field: string): Rating {
  const upper = String(value ?? "").toUpperCase() as Rating;
  if (!RATINGS.includes(upper)) throw new Error(`invalid ${field}: ${String(value)}`);
  return upper;
}

function parseReview(raw: string): ProposalAiReview {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("model returned no JSON object");

  const parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;

  const assessment =
    typeof parsed["assessment"] === "string" ? parsed["assessment"].trim() : "";
  const nextStep = typeof parsed["next_step"] === "string" ? parsed["next_step"].trim() : "";
  const strengths = stringList(parsed["strengths"], 6);
  const risks = stringList(parsed["risks"], 6);
  const recommendations = stringList(parsed["recommendations"], 6);

  if (assessment.length < 20) throw new Error("assessment too short");
  if (nextStep.length < 5) throw new Error("next step too short");
  if (strengths.length === 0) throw new Error("no strengths returned");

  return {
    technicalFeasibility: rating(parsed["technical_feasibility"], "technical_feasibility"),
    impactPotential: rating(parsed["impact_potential"], "impact_potential"),
    implementationComplexity: rating(
      parsed["implementation_complexity"],
      "implementation_complexity",
    ),
    skillAlignment: rating(parsed["skill_alignment"], "skill_alignment"),
    assessment,
    strengths,
    risks,
    recommendations,
    nextStep,
  };
}

const SYSTEM_PROMPT = `You are CivicX Intelligence, evaluating the feasibility of a university student team's solution proposal for a real civic challenge.
Respond with ONLY a JSON object, no prose and no code fences, in exactly this shape:
{
  "technical_feasibility": "LOW" | "MEDIUM" | "HIGH",
  "impact_potential": "LOW" | "MEDIUM" | "HIGH",
  "implementation_complexity": "LOW" | "MEDIUM" | "HIGH",
  "skill_alignment": "LOW" | "MEDIUM" | "HIGH",
  "assessment": "3-4 sentence overall AI assessment of the proposal",
  "strengths": ["string", ...],
  "risks": ["string", ...],
  "recommendations": ["string", ...],
  "next_step": "one concrete next step for the team"
}
Rules:
- Judge strictly on the proposal text, the civic challenge and the team's stated skills. Never invent statistics or external validation.
- "skill_alignment" compares the team's skills with what the proposed solution actually requires.
- "implementation_complexity" describes how hard delivery is, where HIGH means hard.
- Give 2-4 strengths, 2-4 risks and 2-4 recommendations. Word everything so it is clear this is an AI assessment, not verified fact.`;

const readLanguage = (value: unknown): AiLanguage => (value === "hi" ? "hi" : "en");

async function callModel(prompt: string, language: AiLanguage): Promise<string> {
  try {
    return await callGemini({ feature: "proposal-review", system: SYSTEM_PROMPT, prompt, language });
  } catch {
    throw new ReviewUnavailableError();
  }
}

interface PhaseShape {
  name?: unknown;
  description?: unknown;
  outcome?: unknown;
}

/**
 * Reviews a submitted proposal the caller's team owns and stores the result.
 * Existing reviews are returned untouched.
 */
export const reviewProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { proposalId: string; language?: string }) => {
    const id = String(input?.proposalId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("A valid proposal id is required.");
    return { proposalId: id, language: readLanguage(input?.language) };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: proposal, error } = await supabase
      .from("solution_proposals")
      .select("*")
      .eq("id", data.proposalId)
      .maybeSingle();

    if (error) {
      console.error("[civicx] proposal lookup failed", error);
      throw new ReviewUnavailableError();
    }
    if (!proposal) throw new Error("This proposal could not be found.");
    if (proposal.status === "DRAFT")
      throw new Error("Submit the proposal before requesting an AI review.");

    // Never regenerate a stored review.
    const { data: existing } = await supabase
      .from("proposal_reviews")
      .select("*")
      .eq("proposal_id", proposal.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (existing && existing.length > 0) {
      if (proposal.status !== "AI_REVIEW_COMPLETE") {
        await supabase
          .from("solution_proposals")
          .update({ status: "AI_REVIEW_COMPLETE" })
          .eq("id", proposal.id);
      }
      return { review: existing[0]!, regenerated: false };
    }

    const [{ data: challenge }, { data: members }] = await Promise.all([
      supabase
        .from("challenges")
        .select(
          "title, description, category, location_name, priority, ai_summary, recommended_skills, affected_stakeholders",
        )
        .eq("id", proposal.mission_id)
        .maybeSingle(),
      supabase
        .from("team_members")
        .select("user_id, contribution_area")
        .eq("team_id", proposal.team_id),
    ]);

    let teamSkills: string[] = [];
    if (members && members.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("skills")
        .in(
          "id",
          members.map((m) => m.user_id),
        );
      teamSkills = Array.from(
        new Set((profiles ?? []).flatMap((p) => p.skills ?? [])),
      );
    }

    await supabase
      .from("solution_proposals")
      .update({ status: "UNDER_AI_REVIEW" })
      .eq("id", proposal.id);

    const phases = Array.isArray(proposal.implementation_plan)
      ? (proposal.implementation_plan as PhaseShape[])
      : [];

    const prompt = [
      "== CIVIC CHALLENGE ==",
      `Title: ${challenge?.title ?? "not available"}`,
      `Category: ${challenge?.category ?? "not provided"}`,
      `Location: ${challenge?.location_name ?? "not provided"}`,
      `Priority: ${challenge?.priority ?? "not provided"}`,
      `Citizen report: ${challenge?.description ?? "not available"}`,
      `AI summary: ${challenge?.ai_summary ?? "not available"}`,
      `Recommended skills: ${(challenge?.recommended_skills ?? []).join(", ") || "none"}`,
      `Affected stakeholders: ${(challenge?.affected_stakeholders ?? []).join(", ") || "none"}`,
      "",
      "== TEAM ==",
      `Members: ${members?.length ?? 0}`,
      `Combined skills: ${teamSkills.join(", ") || "not provided"}`,
      "",
      "== PROPOSAL ==",
      `Problem understanding: ${proposal.problem_understanding}`,
      `Proposed solution: ${proposal.proposed_solution}`,
      `Technology and approach: ${(proposal.technologies ?? []).join("; ") || "not provided"}`,
      `Expected impact: ${proposal.expected_impact}`,
      `Timeline: ${proposal.estimated_timeline || "not provided"}`,
      `Resources required: ${(proposal.resources_required ?? []).join("; ") || "not provided"}`,
      "Implementation phases:",
      ...(phases.length > 0
        ? phases.map(
            (p, i) =>
              `  ${i + 1}. ${String(p?.name ?? "")} — ${String(p?.description ?? "")} (outcome: ${String(p?.outcome ?? "not stated")})`,
          )
        : ["  none provided"]),
    ].join("\n");

    let review: ProposalAiReview;
    try {
      review = parseReview(await callModel(prompt, data.language));
    } catch (err) {
      console.error("[civicx] proposal AI review failed", err);
      await supabase
        .from("solution_proposals")
        .update({ status: "SUBMITTED" })
        .eq("id", proposal.id);
      throw new ReviewUnavailableError();
    }

    const { data: stored, error: insertError } = await supabase
      .from("proposal_reviews")
      .insert({
        proposal_id: proposal.id,
        technical_feasibility: review.technicalFeasibility,
        impact_potential: review.impactPotential,
        implementation_complexity: review.implementationComplexity,
        skill_alignment: review.skillAlignment,
        assessment: review.assessment,
        strengths: review.strengths,
        risks: review.risks,
        recommendations: review.recommendations,
        next_step: review.nextStep,
      })
      .select()
      .single();

    if (insertError) {
      console.error("[civicx] storing proposal review failed", insertError);
      await supabase
        .from("solution_proposals")
        .update({ status: "SUBMITTED" })
        .eq("id", proposal.id);
      throw new ReviewUnavailableError();
    }

    const { error: statusError } = await supabase
      .from("solution_proposals")
      .update({ status: "AI_REVIEW_COMPLETE" })
      .eq("id", proposal.id);
    if (statusError) {
      console.error("[civicx] proposal status update failed", statusError);
      throw new ReviewUnavailableError();
    }

    return { review: stored, regenerated: true };
  });
