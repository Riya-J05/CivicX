/**
 * CivicX AI — the site-wide assistant.
 *
 * Runs entirely on the server so the model credential never reaches the
 * browser, and every database read uses the caller's own session, so the
 * existing Row Level Security policies decide what the assistant can see.
 * It has no privileged access of any kind.
 */

import { createServerFn } from "@tanstack/react-start";
import { callGemini, type AiLanguage } from "@/lib/ai-gateway.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


const MAX_TURNS = 12;
const MAX_CHARS = 2000;

export class AssistantUnavailableError extends Error {
  constructor() {
    super("CivicX AI is temporarily unavailable. Please try again.");
    this.name = "AssistantUnavailableError";
  }
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

const PLATFORM_KNOWLEDGE = `CIVICX PLATFORM KNOWLEDGE (authoritative — never invent features beyond this):

CivicX is a civic mission-control platform that turns real citizen reports into deployable solutions. The full chain:
1. A citizen reports a civic challenge with a description, photo evidence and a map location.
2. CivicX runs an AI Analysis on the report: it writes a plain-language summary, picks a Category, sets a Priority, lists Recommended Skills and names the Affected Stakeholders. This is an AI assessment, not verified fact.
3. University operators discover the challenge on the University Mission Board.
4. Skill Matching compares each student's saved skill profile against the mission's Recommended Skills and shows a match percentage.
5. Team Formation lets a university operator assemble a Solution Team from matched students. Team Skill Coverage is the share of the mission's recommended skills the team collectively holds. A mission with a formed team becomes Mission Ready / TEAM FORMED.
6. The team writes a Solution Proposal in the Proposal Workspace: problem understanding, proposed solution, technology and approach, expected impact, a phased implementation plan, timeline and resources required. Drafts are saved and only the team leader may submit.
7. Submitting runs the AI Feasibility Review once: Technical Feasibility, Impact Potential, Implementation Complexity and Skill Alignment (each LOW / MEDIUM / HIGH) plus an overall assessment, strengths, risks and recommendations. The proposal locks while it is under review.
8. A reviewed proposal becomes READY FOR INDUSTRY REVIEW and appears as an Industry Opportunity.
9. Industry partners browse Opportunities and express interest; those signals appear to the team as Industry Signals, which can become a Collaboration.
10. Government operators use Government Monitoring to watch challenges, priorities and progress across the platform.
11. Implementation and Impact close the loop once a solution is delivered.

Terminology quick reference: Priority = urgency assigned by AI analysis. Recommended Skills = skills the AI thinks the solution needs. Skill Coverage = recommended skills held by the team. Mission Ready = has a formed team. AI Feasibility Review = the one-time AI assessment of a submitted proposal. Industry Signals = interest expressed by industry partners on a team's proposal.

Roles: citizen (reports challenges, tracks their own reports), university (mission board, team formation, proposals), industry (opportunities, expressing interest, collaborations), government (monitoring and priorities).`;

function systemPrompt(role: string, contextBlock: string): string {
  return `You are CivicX AI, the built-in assistant of the CivicX civic platform. You help the signed-in operator understand and navigate CivicX.

The operator's CivicX role is: ${role.toUpperCase()}. Use the role only to make your help relevant — it never grants extra access.

${PLATFORM_KNOWLEDGE}

${contextBlock}

HOW TO ANSWER
- Simple, clear language. Concise by default; use short numbered steps for "how do I" questions.
- Explain CivicX features, statuses and scores using the knowledge above.
- Only describe records that appear in the CONTEXT block. It contains solely what this operator is already authorised to see.
- If someone asks for private data — other people's evidence, citizen contact details, another team's draft, anything not in the CONTEXT block — refuse plainly: explain that you can only discuss what their own CivicX account can already see, and that private records stay protected. Never guess at such data.
- If CivicX context cannot answer the question, say exactly: "I don't have enough information to answer that accurately." Then, if useful, give a short general explanation.
- General civic or technical questions (sensors, technologies, approaches) are welcome, but label them clearly as general suggestions, e.g. start with "General suggestion (not CivicX data):". Never present them as official government guidance or verified fact.
- Never invent CivicX features, buttons, pages or statuses that are not in the knowledge above.
- Keep formatting light: short paragraphs, dashed lists, occasional bold. No headings or tables.`;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").join(", ")
    : "";
}

interface FocusInput {
  missionId?: string | null;
  teamId?: string | null;
  proposalId?: string | null;
}

const uuid = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
};

/**
 * Builds the context block from records the caller can already read. Every
 * query runs through the caller's RLS-scoped client, so a denied record simply
 * comes back empty and is left out.
 */
async function buildContext(
  supabase: {
    from: (table: string) => any;
  },
  focus: FocusInput,
): Promise<string> {
  const parts: string[] = [];

  const missionId = uuid(focus.missionId);
  const teamId = uuid(focus.teamId);
  const proposalId = uuid(focus.proposalId);

  if (missionId) {
    const { data } = await supabase
      .from("challenges")
      .select(
        "title, description, category, location_name, priority, status, ai_summary, recommended_skills, affected_stakeholders",
      )
      .eq("id", missionId)
      .maybeSingle();
    if (data) {
      parts.push(
        [
          "Challenge / mission currently on screen:",
          `- Title: ${clean(data.title) || "untitled"}`,
          `- Category: ${clean(data.category) || "unknown"}`,
          `- Location: ${clean(data.location_name) || "not given"}`,
          `- Priority: ${clean(data.priority) || "unset"}`,
          `- Status: ${clean(data.status) || "unset"}`,
          `- Description: ${clean(data.description).slice(0, 900)}`,
          `- AI summary: ${clean(data.ai_summary).slice(0, 900)}`,
          `- Recommended skills: ${list(data.recommended_skills) || "none listed"}`,
          `- Affected stakeholders: ${list(data.affected_stakeholders) || "none listed"}`,
        ].join("\n"),
      );
    }
  }

  if (teamId) {
    const [{ data: team }, { data: members }] = await Promise.all([
      supabase
        .from("teams")
        .select("team_name, skill_coverage, status, mission_id")
        .eq("id", teamId)
        .maybeSingle(),
      supabase.from("team_members").select("user_id, contribution_area").eq("team_id", teamId),
    ]);

    if (team) {
      let skills: string[] = [];
      const ids = Array.isArray(members)
        ? members.map((m: { user_id: string }) => m.user_id).filter(Boolean)
        : [];
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("skills").in("id", ids);
        skills = Array.isArray(profiles)
          ? profiles.flatMap((p: { skills: string[] | null }) => p.skills ?? [])
          : [];
      }
      parts.push(
        [
          "Solution team currently on screen:",
          `- Team name: ${clean(team.team_name) || "unnamed"}`,
          `- Team status: ${clean(team.status) || "unset"}`,
          `- Skill coverage: ${team.skill_coverage ?? "unknown"}%`,
          `- Members: ${ids.length}`,
          `- Combined member skills: ${[...new Set(skills)].join(", ") || "none recorded"}`,
        ].join("\n"),
      );
    }
  }

  if (proposalId) {
    const { data: proposal } = await supabase
      .from("solution_proposals")
      .select(
        "status, problem_understanding, proposed_solution, expected_impact, technologies, resources_required, estimated_timeline",
      )
      .eq("id", proposalId)
      .maybeSingle();

    if (proposal) {
      parts.push(
        [
          "Solution proposal currently on screen:",
          `- Status: ${clean(proposal.status) || "unset"}`,
          `- Problem understanding: ${clean(proposal.problem_understanding).slice(0, 700)}`,
          `- Proposed solution: ${clean(proposal.proposed_solution).slice(0, 900)}`,
          `- Expected impact: ${clean(proposal.expected_impact).slice(0, 700)}`,
          `- Technologies: ${list(proposal.technologies) || "none listed"}`,
          `- Resources required: ${list(proposal.resources_required) || "none listed"}`,
          `- Timeline: ${clean(proposal.estimated_timeline) || "not given"}`,
        ].join("\n"),
      );

      const { data: reviews } = await supabase
        .from("proposal_reviews")
        .select(
          "technical_feasibility, impact_potential, implementation_complexity, skill_alignment, assessment, strengths, risks, recommendations, next_step",
        )
        .eq("proposal_id", proposalId)
        .order("created_at", { ascending: false })
        .limit(1);

      const review = Array.isArray(reviews) ? reviews[0] : null;
      if (review) {
        parts.push(
          [
            "AI feasibility review of that proposal:",
            `- Technical feasibility: ${clean(review.technical_feasibility)}`,
            `- Impact potential: ${clean(review.impact_potential)}`,
            `- Implementation complexity: ${clean(review.implementation_complexity)}`,
            `- Skill alignment: ${clean(review.skill_alignment)}`,
            `- Assessment: ${clean(review.assessment).slice(0, 900)}`,
            `- Strengths: ${list(review.strengths)}`,
            `- Risks: ${list(review.risks)}`,
            `- Recommendations: ${list(review.recommendations)}`,
            `- Suggested next step: ${clean(review.next_step)}`,
          ].join("\n"),
        );
      }
    }
  }

  if (parts.length === 0) {
    return "CONTEXT: The operator is not viewing a specific mission, team or proposal right now. Answer from CivicX platform knowledge, and ask them to open the relevant mission if they refer to a specific one.";
  }

  return `CONTEXT (records this operator is already authorised to see — nothing outside this block may be described):\n\n${parts.join("\n\n")}`;
}

/** Answers one assistant question for the signed-in operator. */
export const askCivicxAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      question: string;
      history?: AssistantTurn[];
      focus?: FocusInput;
      language?: string;
    }) => {
      const question = String(input?.question ?? "").trim();
      if (question.length === 0) throw new Error("Type a question first.");
      const history = Array.isArray(input?.history)
        ? input.history
            .filter(
              (t): t is AssistantTurn =>
                !!t &&
                (t.role === "user" || t.role === "assistant") &&
                typeof t.content === "string" &&
                t.content.trim().length > 0,
            )
            .slice(-MAX_TURNS)
            .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_CHARS) }))
        : [];
      return {
        question: question.slice(0, MAX_CHARS),
        history,
        language: (input?.language === "hi" ? "hi" : "en") as AiLanguage,
        focus: {
          missionId: input?.focus?.missionId ?? null,
          teamId: input?.focus?.teamId ?? null,
          proposalId: input?.focus?.proposalId ?? null,
        },
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    const role = clean(profile?.role) || "citizen";
    const contextBlock = await buildContext(supabase as never, data.focus);

    let answer: string;
    try {
      answer = clean(
        await callGemini({
          feature: "assistant",
          system: systemPrompt(role, contextBlock),
          turns: [...data.history, { role: "user", content: data.question }],
          language: data.language,
        }),
      );
    } catch {
      throw new AssistantUnavailableError();
    }

    if (!answer) {
      console.error("[civicx] assistant response had no content");
      throw new AssistantUnavailableError();
    }

    return { answer };
  });
