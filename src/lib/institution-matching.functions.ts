/**
 * AI-assisted institution matching (Level 1) for a civic challenge.
 *
 * Server-side only: the model credential never reaches the browser. Both the
 * challenge read and the university profile read use the caller's own session,
 * so the existing Row Level Security policies decide what is visible.
 *
 * The model does two narrow jobs:
 *   1. extract structured expertise requirements from the challenge text
 *   2. explain, in one sentence, why a ranked institution fits
 *
 * The percentage itself is always deterministic arithmetic from
 * `institution-matching.ts`, and the explanations are constrained to the
 * capability lists that are actually stored in the database.
 */

import { createServerFn } from "@tanstack/react-start";
import { callGemini, type AiLanguage } from "@/lib/ai-gateway.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  baselineRequirements,
  hasInstitutionData,
  scoreInstitution,
  type ChallengeRequirements,
  type InstitutionProfile,
  type ScoreComponent,
} from "@/lib/institution-matching";
import { toInstitutionProfile } from "@/lib/institution-service";

const MAX_EXPLAINED = 5;

export interface InstitutionMatch {
  profileId: string;
  institutionName: string;
  contactName: string | null;
  district: string | null;
  percent: number | null;
  primaryDomains: string[];
  matchedCapabilities: string[];
  missingCapabilities: string[];
  researchAreas: string[];
  facilities: string[];
  components: ScoreComponent[];
  /** One-sentence explanation, or null when no explanation is available. */
  why: string | null;
}

export interface InstitutionMatchResult {
  requirements: ChallengeRequirements;
  /** Ranked institutions, highest match first. */
  matches: InstitutionMatch[];
  /** The signed-in account's own institution match, when discoverable. */
  ownMatch: InstitutionMatch | null;
  /** True when the requirements came from the model rather than the row alone. */
  aiRequirements: boolean;
  /** True when the "why this match" sentences came from the model. */
  aiExplanations: boolean;
}

const REQUIREMENTS_PROMPT = `You are CivicX Intelligence extracting the expertise a civic challenge requires.
Respond with ONLY a JSON object, no prose and no code fences:
{
  "primary_domain": "short domain label, e.g. Water Management",
  "domains": ["civic domain labels"],
  "disciplines": ["academic disciplines, e.g. Civil Engineering"],
  "skills": ["technical skills/capabilities needed"],
  "research_areas": ["relevant research areas"],
  "technologies": ["specific technologies needed, e.g. GIS, IoT"],
  "facilities": ["laboratory or facility capabilities needed"],
  "needs_incubation": true | false
}
Rules:
- Base everything strictly on the challenge text supplied. Do not invent statistics or name any institution.
- 1-3 domains, 2-4 disciplines, 3-6 skills, 1-3 research areas, 1-4 technologies, 0-3 facilities.
- Use short, general labels a university profile could plausibly list.
- "needs_incubation" is true only when the solution plainly needs prototyping, piloting or startup/incubation support.`;

const EXPLANATION_PROMPT = `You are CivicX Intelligence explaining institution matches for a civic challenge.
For each institution you are given its ALREADY CALCULATED match percentage and the exact capabilities recorded in the CivicX database.
Respond with ONLY a JSON array, no prose and no code fences:
[{"profile_id":"uuid","why":"one sentence, max 25 words"}]
Rules:
- Use ONLY the matched and missing capabilities listed for that institution. Never invent a capability, lab, department, ranking or achievement.
- Never change or restate a different percentage than the one given.
- If an institution has very little recorded capability data, say plainly that its recorded capability data is limited.
- Include exactly one object per institution, using the profile_id given.`;

const readLanguage = (value: unknown): AiLanguage => (value === "hi" ? "hi" : "en");

async function callModel(system: string, user: string, language: AiLanguage): Promise<string> {
  return callGemini({ feature: "institution-matching", system, prompt: user, language });
}

function extractJson(raw: string, open: "{" | "["): string {
  const close = open === "{" ? "}" : "]";
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf(open);
  const end = body.lastIndexOf(close);
  if (start === -1 || end <= start) throw new Error("model returned no JSON");
  return body.slice(start, end + 1);
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, max);
}

function mergeUnique(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const value of list) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

export const matchInstitutions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { challengeId: string; language?: string }) => {
    const id = String(input?.challengeId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("A valid challenge id is required.");
    return { challengeId: id, language: readLanguage(input?.language) };
  })
  .handler(async ({ data, context }): Promise<InstitutionMatchResult> => {
    const { supabase, userId } = context;

    const { data: challenge, error } = await supabase
      .from("challenges")
      .select(
        "id, title, description, category, recommended_skills, solution_directions, affected_stakeholders, location_name, locality, city, state, priority",
      )
      .eq("id", data.challengeId)
      .maybeSingle();

    if (error) {
      console.error("[civicx] institution matching challenge lookup failed", error);
      throw new Error("We could not load this mission for institution matching.");
    }
    if (!challenge) throw new Error("This mission could not be found.");

    // RLS decides which university profiles are discoverable at all.
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id, name, institution, district, academic_disciplines, research_areas, faculty_expertise, lab_capabilities, innovation_facilities, tech_capabilities, civic_domains, expertise_areas, skills",
      )
      .eq("role", "university");

    if (profileError) {
      console.error("[civicx] institution profile read failed", profileError);
      throw new Error("We could not load institution profiles right now.");
    }

    const baseline = baselineRequirements(challenge);
    let requirements = baseline;
    let aiRequirements = false;

    try {
      const raw = await callModel(
        REQUIREMENTS_PROMPT,
        [
          `Title: ${challenge.title}`,
          `Description: ${challenge.description}`,
          `Category: ${challenge.category ?? "not provided"}`,
          `AI recommended skills: ${(challenge.recommended_skills ?? []).join(", ") || "none"}`,
          `Solution directions: ${(challenge.solution_directions ?? []).join("; ") || "none"}`,
          `Location: ${[challenge.location_name, challenge.locality, challenge.city, challenge.state].filter(Boolean).join(", ") || "not provided"}`,
        ].join("\n"),
      );
      const parsed = JSON.parse(extractJson(raw, "{")) as Record<string, unknown>;
      const domains = stringList(parsed["domains"], 3);
      requirements = {
        primaryDomain:
          typeof parsed["primary_domain"] === "string" && parsed["primary_domain"].trim()
            ? parsed["primary_domain"].trim()
            : (domains[0] ?? baseline.primaryDomain),
        domains: mergeUnique(domains, baseline.domains),
        disciplines: stringList(parsed["disciplines"], 4),
        // the existing AI recommended skills stay authoritative
        skills: mergeUnique(baseline.skills, stringList(parsed["skills"], 6)),
        researchAreas: stringList(parsed["research_areas"], 3),
        technologies: stringList(parsed["technologies"], 4),
        facilities: stringList(parsed["facilities"], 3),
        needsIncubation: parsed["needs_incubation"] === true,
        locationTerms: baseline.locationTerms,
      };
      aiRequirements = true;
    } catch (err) {
      console.error("[civicx] requirement extraction failed, using stored data", err);
    }

    const profiles: InstitutionProfile[] = (profileRows ?? []).map((row) =>
      toInstitutionProfile(row as never),
    );

    const scored: InstitutionMatch[] = profiles
      .filter((p) => hasInstitutionData(p))
      .map((profile) => {
        const score = scoreInstitution(profile, requirements);
        return {
          profileId: profile.id,
          institutionName: profile.institution ?? "Unnamed institution",
          contactName: profile.name,
          district: profile.district,
          percent: score.percent,
          primaryDomains: score.primaryDomains,
          matchedCapabilities: score.matchedCapabilities,
          missingCapabilities: score.missingCapabilities,
          researchAreas: profile.researchAreas,
          facilities: mergeUnique(profile.labCapabilities, profile.innovationFacilities),
          components: score.components,
          why: null,
        };
      })
      .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));

    let aiExplanations = false;
    const explained = scored.slice(0, MAX_EXPLAINED);
    if (explained.length > 0) {
      try {
        const raw = await callModel(
          EXPLANATION_PROMPT,
          [
            `Challenge: ${challenge.title}`,
            `Primary domain required: ${requirements.primaryDomain ?? "not identified"}`,
            `Required disciplines: ${requirements.disciplines.join(", ") || "none recorded"}`,
            `Required skills: ${requirements.skills.join(", ") || "none recorded"}`,
            "",
            "Institutions:",
            ...explained.map((m) =>
              [
                `- profile_id: ${m.profileId}`,
                `  match_percent: ${m.percent ?? "insufficient data"}`,
                `  matched_capabilities: ${m.matchedCapabilities.join(", ") || "none recorded"}`,
                `  missing_capabilities: ${m.missingCapabilities.join(", ") || "none"}`,
                `  recorded_research_areas: ${m.researchAreas.join(", ") || "none recorded"}`,
                `  recorded_facilities: ${m.facilities.join(", ") || "none recorded"}`,
              ].join("\n"),
            ),
          ].join("\n"),
        );
        const list = JSON.parse(extractJson(raw, "[")) as unknown;
        if (Array.isArray(list)) {
          for (const entry of list) {
            const item = entry as Record<string, unknown>;
            const id = String(item["profile_id"] ?? "");
            const why = typeof item["why"] === "string" ? item["why"].trim() : "";
            const target = explained.find((m) => m.profileId === id);
            if (target && why) {
              target.why = why;
              aiExplanations = true;
            }
          }
        }
      } catch (err) {
        console.error("[civicx] institution explanation failed", err);
      }
    }

    return {
      requirements,
      matches: scored,
      ownMatch: scored.find((m) => m.profileId === userId) ?? null,
      aiRequirements,
      aiExplanations,
    };
  });
