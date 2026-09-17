import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Lock,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import {
  proposalSections,
  proposalStatusMeta,
  reviewProgressSteps,
  type ProposalStatus,
} from "@/lib/proposal-data";
import {
  emptyDraft,
  emptyPhase,
  getProposalForTeam,
  isIndustryReady,
  missingSections,
  saveProposalDraft,
  sectionComplete,
  submitProposal,
  toDraft,
  type ProposalDraft,
  type ProposalReviewRow,
  type ProposalRow,
} from "@/lib/proposals-service";
import { reviewProposal } from "@/lib/proposal-review.functions";
import { useLanguage } from "@/lib/i18n";
import type { ChallengeRow } from "@/lib/challenges-service";
import type { TeamWithMembers } from "@/lib/teams-service";
import { ProposalReviewPanel } from "./ProposalReviewPanel";

const timeStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function SectionShell({
  id,
  index,
  title,
  caption,
  children,
}: {
  id: string;
  index: string;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`proposal-${id}`} className="glass rounded-2xl p-5 sm:p-6">
      <p className="mono-label text-cyan/90">
        {index} · {title.toUpperCase()}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{caption}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const fieldClass =
  "w-full rounded-xl border border-border bg-background/40 p-3.5 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-cyan/50 disabled:opacity-70";

/**
 * Mission Brief → Solution Blueprint workspace. Every field is persisted to the
 * existing `solution_proposals` row; the AI review comes from the existing
 * server-side review function and `proposal_reviews` table.
 */
export function ProposalWorkspace({
  entry,
  mission,
  currentUserId,
  onBack,
  onViewIndustryInterest,
  onChanged,
}: {
  entry: TeamWithMembers;
  mission: ChallengeRow | null;
  currentUserId: string | null;
  onBack: () => void;
  onViewIndustryInterest: () => void;
  onChanged?: () => void;
}) {
  const [proposal, setProposal] = useState<ProposalRow | null>(null);
  const [review, setReview] = useState<ProposalReviewRow | null>(null);
  const [draft, setDraft] = useState<ProposalDraft>(emptyDraft);
  const { language } = useLanguage();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reviewRequested = useRef(false);

  const isOwner = !!currentUserId && entry.team.created_by === currentUserId;
  const membership = entry.members.find((m) => m.user_id === currentUserId) ?? null;
  const isMember = isOwner || !!membership;
  const canSubmit = isOwner || !!membership?.is_leader;

  const status = (proposal?.status ?? "DRAFT") as ProposalStatus;
  const locked = !!proposal && status !== "DRAFT";
  const readOnly = locked || !isMember;
  const industryReady = isIndustryReady(proposal, review);

  const load = useCallback(async () => {
    try {
      const bundle = await getProposalForTeam(entry.team.id, entry.team.mission_id);
      setProposal(bundle.proposal);
      setReview(bundle.review);
      if (bundle.proposal) {
        setDraft(toDraft(bundle.proposal));
        setSavedAt(bundle.proposal.updated_at);
      }
    } catch (err) {
      console.error("[civicx] proposal load failed", err);
      setError("This proposal could not be loaded.");
    } finally {
      setLoaded(true);
    }
  }, [entry.team.id, entry.team.mission_id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run the existing AI review once for a submitted proposal without one. */
  const runReview = useCallback(
    async (proposalId: string) => {
      if (reviewRequested.current) return;
      reviewRequested.current = true;
      setReviewing(true);
      setProgressStep(0);
      try {
        const result = await reviewProposal({ data: { proposalId, language } });
        setReview(result.review as ProposalReviewRow);
        await load();
        onChanged?.();
      } catch (err) {
        console.error("[civicx] proposal review failed", err);
        setError(
          err instanceof Error
            ? err.message
            : "The AI feasibility review could not be completed.",
        );
        reviewRequested.current = false;
        await load();
      } finally {
        setReviewing(false);
      }
    },
    [load, onChanged, language],
  );

  useEffect(() => {
    if (!loaded || !proposal || review) return;
    if (status === "SUBMITTED" || status === "UNDER_AI_REVIEW") {
      void runReview(proposal.id);
    }
  }, [loaded, proposal, review, status, runReview]);

  useEffect(() => {
    if (!reviewing) return;
    const id = window.setInterval(() => {
      setProgressStep((s) => (s + 1) % reviewProgressSteps.length);
    }, 1400);
    return () => window.clearInterval(id);
  }, [reviewing]);

  const missing = useMemo(() => missingSections(draft), [draft]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const row = await saveProposalDraft({
        proposalId: proposal?.id ?? null,
        teamId: entry.team.id,
        missionId: entry.team.mission_id,
        draft,
      });
      setProposal(row);
      setSavedAt(row.updated_at);
      onChanged?.();
    } catch (err) {
      console.error("[civicx] draft save failed", err);
      setError("The draft could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const saved = await saveProposalDraft({
        proposalId: proposal?.id ?? null,
        teamId: entry.team.id,
        missionId: entry.team.mission_id,
        draft,
      });
      const submitted = await submitProposal(saved.id);
      setProposal(submitted);
      setConfirming(false);
      onChanged?.();
      await runReview(submitted.id);
    } catch (err) {
      console.error("[civicx] proposal submit failed", err);
      setError(
        err instanceof Error && err.message.includes("team leader")
          ? "Only the team leader can submit this proposal."
          : "The proposal could not be submitted. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const scrollTo = (id: string) => {
    document
      .getElementById(`proposal-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const updatePhase = (i: number, patch: Partial<ProposalDraft["phases"][number]>) => {
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    }));
  };

  if (!isMember) {
    return (
      <section className="glass grid-floor rounded-2xl px-6 py-20 text-center">
        <p className="mono-label inline-flex items-center justify-center gap-2 text-warn">
          <Lock className="h-3.5 w-3.5" />
          TEAM ACCESS REQUIRED
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Only members of this team can open its solution proposal workspace.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mono-label mx-auto mt-6 rounded-xl border border-border px-3.5 py-2 text-muted-foreground"
        >
          BACK TO TEAM
        </button>
      </section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-4"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        BACK TO TEAM COMMAND CENTER
      </button>

      {/* Header */}
      <div className="glass grid-floor relative overflow-hidden rounded-2xl p-5 sm:p-7">
        <span className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan/20 opacity-40 blur-3xl" />
        <p className="mono-label text-cyan/90">SOLUTION PROPOSAL</p>
        <h2 className="relative mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
          Transform this civic challenge into a deployable solution.
        </h2>
        <div className="relative mt-4 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] ${proposalStatusMeta[status].tone}`}
          >
            {proposalStatusMeta[status].label}
          </span>
          <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
            {entry.team.team_name.toUpperCase()} · {entry.members.length} MEMBERS
          </span>
        </div>
        <p className="relative mt-2 text-sm text-muted-foreground">
          {proposalStatusMeta[status].caption}
        </p>
      </div>

      {/* Mission brief from the stored challenge record */}
      <div className="glass rounded-2xl p-5 sm:p-6">
        <p className="mono-label text-violet/90">MISSION BRIEF</p>
        <h3 className="mt-2 text-lg font-semibold tracking-tight">
          {mission?.title ?? "Mission unavailable"}
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            mission?.category ?? null,
            mission?.location_name ?? null,
            mission?.priority ? `${mission.priority} PRIORITY` : null,
          ]
            .filter((v): v is string => !!v)
            .map((v) => (
              <span
                key={v}
                className="rounded-lg border border-border px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground"
              >
                {v.toUpperCase()}
              </span>
            ))}
        </div>
        {mission?.ai_summary && (
          <p className="mt-4 text-sm leading-relaxed text-foreground/85">
            {mission.ai_summary}
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(mission?.recommended_skills ?? []).length > 0 && (
            <div className="glass-soft rounded-xl p-4">
              <p className="mono-label text-muted-foreground">RECOMMENDED SKILLS</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(mission?.recommended_skills ?? []).map((s) => (
                  <span
                    key={s}
                    className="rounded-lg border border-cyan/30 bg-cyan/5 px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-cyan"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(mission?.affected_stakeholders ?? []).length > 0 && (
            <div className="glass-soft rounded-xl p-4">
              <p className="mono-label text-muted-foreground">AFFECTED STAKEHOLDERS</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(mission?.affected_stakeholders ?? []).map((s) => (
                  <span
                    key={s}
                    className="rounded-lg border border-border px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {!loaded && (
        <p className="mono-label px-1 py-10 text-center text-muted-foreground">
          LOADING PROPOSAL RECORD…
        </p>
      )}

      {loaded && (
        <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
          {/* Progress navigator */}
          <nav className="glass h-max rounded-2xl p-4 lg:sticky lg:top-6">
            <p className="mono-label text-muted-foreground">BLUEPRINT PROGRESS</p>
            <ul className="mt-3 space-y-1">
              {proposalSections.map((s) => {
                const done =
                  s.id === "review"
                    ? status === "AI_REVIEW_COMPLETE"
                    : sectionComplete(draft, s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => scrollTo(s.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left font-mono text-[10px] tracking-[0.12em] text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
                    >
                      {done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-signal" />
                      ) : (
                        <CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                      )}
                      <span className={done ? "text-foreground" : ""}>
                        {s.index} {s.navLabel}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 space-y-4">
            {locked && (
              <div className="glass-soft rounded-2xl border border-azure/30 p-4">
                <p className="mono-label inline-flex items-center gap-2 text-azure">
                  <Lock className="h-3.5 w-3.5" />
                  PROPOSAL LOCKED — READ ONLY
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  This proposal was submitted
                  {proposal?.submitted_at ? ` on ${timeStamp(proposal.submitted_at)}` : ""} and
                  can no longer be edited.
                </p>
              </div>
            )}

            <SectionShell
              id="problem"
              index="01"
              title="Problem Understanding"
              caption="Show that the team truly understands the civic challenge."
            >
              <textarea
                rows={7}
                disabled={readOnly}
                value={draft.problemUnderstanding}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, problemUnderstanding: e.target.value }))
                }
                placeholder="Explain your understanding of the civic problem, its causes, affected users and why it needs to be solved."
                className={fieldClass}
              />
            </SectionShell>

            <SectionShell
              id="solution"
              index="02"
              title="Proposed Solution"
              caption="The blueprint your team will build."
            >
              <textarea
                rows={7}
                disabled={readOnly}
                value={draft.proposedSolution}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, proposedSolution: e.target.value }))
                }
                placeholder="Describe your proposed solution and how it addresses the identified problem."
                className={fieldClass}
              />
            </SectionShell>

            <SectionShell
              id="technology"
              index="03"
              title="Technology & Approach"
              caption="How the solution is engineered. One technology or approach per line."
            >
              <textarea
                rows={6}
                disabled={readOnly}
                value={draft.technologies}
                onChange={(e) => setDraft((d) => ({ ...d, technologies: e.target.value }))}
                placeholder="Describe technologies, architecture, methodology, AI/ML components, hardware or other technical approaches."
                className={fieldClass}
              />
            </SectionShell>

            <SectionShell
              id="impact"
              index="04"
              title="Expected Impact"
              caption="What changes for the city once this ships."
            >
              <textarea
                rows={6}
                disabled={readOnly}
                value={draft.expectedImpact}
                onChange={(e) => setDraft((d) => ({ ...d, expectedImpact: e.target.value }))}
                placeholder="Describe the expected social, environmental, economic or operational impact."
                className={fieldClass}
              />
            </SectionShell>

            <SectionShell
              id="implementation"
              index="05"
              title="Phased Implementation Plan"
              caption="Break delivery into phases with clear outcomes."
            >
              <div className="space-y-3">
                {draft.phases.map((phase, i) => (
                  <div key={i} className="glass-soft rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="mono-label text-azure/90">PHASE {i + 1}</p>
                      {!readOnly && draft.phases.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              phases: d.phases.filter((_, idx) => idx !== i),
                            }))
                          }
                          className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                          REMOVE
                        </button>
                      )}
                    </div>
                    <input
                      disabled={readOnly}
                      value={phase.name}
                      onChange={(e) => updatePhase(i, { name: e.target.value })}
                      placeholder="Phase name"
                      className={`${fieldClass} mt-3`}
                    />
                    <textarea
                      rows={3}
                      disabled={readOnly}
                      value={phase.description}
                      onChange={(e) => updatePhase(i, { description: e.target.value })}
                      placeholder="What the team does in this phase"
                      className={`${fieldClass} mt-2`}
                    />
                    <input
                      disabled={readOnly}
                      value={phase.outcome}
                      onChange={(e) => updatePhase(i, { outcome: e.target.value })}
                      placeholder="Expected outcome of this phase"
                      className={`${fieldClass} mt-2`}
                    />
                  </div>
                ))}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({ ...d, phases: [...d.phases, emptyPhase()] }))
                    }
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan/30 bg-cyan/5 px-3.5 py-2 font-mono text-[10px] tracking-[0.16em] text-cyan transition-colors hover:border-cyan/60"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    ADD PHASE
                  </button>
                )}
              </div>
            </SectionShell>

            <SectionShell
              id="timeline"
              index="06"
              title="Timeline"
              caption="Expected implementation window."
            >
              <input
                disabled={readOnly}
                value={draft.estimatedTimeline}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, estimatedTimeline: e.target.value }))
                }
                placeholder="e.g. 12 weeks starting January 2026"
                className={fieldClass}
              />
            </SectionShell>

            <SectionShell
              id="resources"
              index="07"
              title="Resources Required"
              caption="Technical resources, infrastructure, human resources and funding. One per line."
            >
              <textarea
                rows={6}
                disabled={readOnly}
                value={draft.resourcesRequired}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, resourcesRequired: e.target.value }))
                }
                placeholder="Technical resources, infrastructure, human resources, funding or other resources required."
                className={fieldClass}
              />
            </SectionShell>

            {/* Actions */}
            {!readOnly && (
              <div className="glass rounded-2xl p-5 sm:p-6">
                <p className="mono-label text-cyan/90">08 · SUBMIT FOR AI REVIEW</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Save as often as you like. Submission is final and can only be done by the
                  team leader.
                </p>

                {missing.length > 0 && (
                  <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-[0.12em] text-warn">
                    INCOMPLETE · {missing.join(" · ").toUpperCase()}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-foreground transition-colors hover:border-cyan/50 disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    SAVE DRAFT
                  </button>

                  <button
                    type="button"
                    disabled={missing.length > 0 || !canSubmit}
                    onClick={() => setConfirming(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan/40 bg-cyan/10 px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-cyan transition-colors hover:border-cyan/70 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    SUBMIT FOR AI REVIEW
                  </button>

                  {savedAt && (
                    <span className="font-mono text-[10px] tracking-[0.14em] text-signal">
                      DRAFT SAVED · {timeStamp(savedAt).toUpperCase()}
                    </span>
                  )}
                </div>

                {!canSubmit && (
                  <p className="mono-label mt-3 inline-flex items-center gap-2 text-warn">
                    <Lock className="h-3 w-3" />
                    ONLY THE TEAM LEADER CAN SUBMIT THIS PROPOSAL
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="glass-soft rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
                {error}
              </p>
            )}

            {/* AI review */}
            <div id="proposal-review" className="space-y-4">
              {reviewing && (
                <div className="glass grid-floor relative overflow-hidden rounded-2xl p-6 text-center">
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-cyan/40" />
                  <p className="mono-label inline-flex items-center gap-2 text-cyan">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    CIVICX AI FEASIBILITY REVIEW RUNNING
                  </p>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={progressStep}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.35 }}
                      className="mt-4 font-mono text-[11px] tracking-[0.16em] text-foreground"
                    >
                      {reviewProgressSteps[progressStep]}
                    </motion.p>
                  </AnimatePresence>
                  <div className="mx-auto mt-4 h-1 w-56 overflow-hidden rounded-full bg-border">
                    <motion.div
                      animate={{ x: ["-100%", "100%"] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                      className="h-full w-1/2 rounded-full"
                      style={{ backgroundImage: "var(--gradient-accent)" }}
                    />
                  </div>
                </div>
              )}

              {review && (
                <ProposalReviewPanel
                  review={review}
                  industryReady={industryReady}
                  onViewIndustryInterest={onViewIndustryInterest}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submit confirmation */}
      <AnimatePresence>
        {confirming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="glass grid-floor w-full max-w-md rounded-2xl p-6"
            >
              <p className="mono-label text-cyan/90">SUBMIT SOLUTION?</p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/85">
                Once submitted, the proposal will be sent for AI feasibility evaluation. Make
                sure all sections are complete.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-xl border border-border px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submit()}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan/40 bg-cyan/10 px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-cyan transition-colors hover:border-cyan/70 disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  SUBMIT PROPOSAL
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
