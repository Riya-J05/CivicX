import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileText, MapPin, X } from "lucide-react";
import { PriorityChip, StatusChip } from "@/components/civicx/StatusChip";
import { MissionProgress } from "@/components/civicx/MissionProgress";
import { statusStage } from "@/lib/civicx-data";
import {
  getChallengeById,
  getChallengeEvidence,
  getEvidenceUrl,
  toCitizenMission,
  type ChallengeRow,
  type EvidenceRow,
} from "@/lib/challenges-service";
import { readThreat } from "@/lib/emergency-service";
import { ThreatAlert } from "@/components/emergency/ThreatAlert";
import { useAuth } from "@/lib/auth-context";


/** Read-only detail view for a stored challenge. */
export function MissionDetail({
  challengeId,
  onClose,
}: {
  challengeId: string | null;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const { currentProfile } = useAuth();

  const [row, setRow] = useState<ChallengeRow | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;
    setRow(null);
    setEvidence([]);
    setError(null);

    void (async () => {
      try {
        const [challenge, files] = await Promise.all([
          getChallengeById(challengeId),
          getChallengeEvidence(challengeId),
        ]);
        if (cancelled) return;
        setRow(challenge);
        setEvidence(files);
      } catch (err) {
        console.error("[civicx] mission detail failed", err);
        if (!cancelled) setError("We could not load this mission right now.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [challengeId]);

  const mission = row ? toCitizenMission(row) : null;

  return (
    <AnimatePresence>
      {challengeId && (
        <div className="fixed inset-0 z-[90] overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 bg-background/85 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="Mission detail"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
            className="relative mx-auto my-6 w-[min(48rem,calc(100%-1.5rem))]"
          >
            <div className="glass grid-floor relative overflow-hidden rounded-[1.75rem] p-5 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="mono-label text-cyan/90">
                    {mission?.code ?? "CIVICX // MISSION"}
                  </p>
                  <h2 className="mt-2 truncate text-xl font-semibold tracking-tight sm:text-2xl">
                    {row?.title ?? (error ? "Mission unavailable" : "Loading mission…")}
                  </h2>
                  {row && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {row.location_name ?? "Location pending"}
                      {row.latitude !== null && row.longitude !== null && (
                        <span className="font-mono">
                          {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close mission detail"
                  className="rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

              {row && mission && (
                <>
                  <div className="mt-6 flex flex-wrap items-center gap-2">
                    <PriorityChip priority={mission.priority} />
                    <StatusChip status={mission.status} />
                  </div>

                  <MissionProgress activeStage={statusStage[mission.status]} className="mt-7" />

                  <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Cell label="CATEGORY" value={row.category ?? "—"} />
                    <Cell
                      label="AI CONFIDENCE"
                      value={row.ai_confidence !== null ? `${row.ai_confidence}%` : "—"}
                    />
                    <Cell
                      label="ESTIMATED IMPACT"
                      value={
                        row.estimated_impact !== null
                          ? `${row.estimated_impact.toLocaleString()} citizens`
                          : "—"
                      }
                    />
                    <Cell label="REPORTED" value={mission.reported} />
                  </div>

                  <Block label="DESCRIPTION">
                    <p className="text-sm leading-relaxed text-foreground/85">{row.description}</p>
                  </Block>

                  {row.ai_summary && (
                    <Block label="AI SUMMARY">
                      <p className="text-sm leading-relaxed text-foreground/85">{row.ai_summary}</p>
                    </Block>
                  )}

                  <ThreatAlert
                    threat={readThreat(row)}
                    challengeId={row.id}
                    canEscalate={row.created_by === currentProfile?.id}
                  />


                  {row.recommended_skills && row.recommended_skills.length > 0 && (
                    <Block label="RECOMMENDED SKILLS">
                      <div className="flex flex-wrap gap-2">
                        {row.recommended_skills.map((s) => (
                          <span
                            key={s}
                            className="rounded-lg border border-cyan/30 bg-cyan/5 px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-cyan"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </Block>
                  )}

                  {row.affected_stakeholders && row.affected_stakeholders.length > 0 && (
                    <Block label="AFFECTED STAKEHOLDERS">
                      <div className="flex flex-wrap gap-2">
                        {row.affected_stakeholders.map((s) => (
                          <span
                            key={s}
                            className="rounded-lg border border-violet/30 bg-violet/5 px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-violet"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </Block>
                  )}

                  {row.solution_directions && row.solution_directions.length > 0 && (
                    <Block label="SOLUTION DIRECTIONS">
                      <ul className="space-y-2">
                        {row.solution_directions.map((d) => (
                          <li key={d} className="flex gap-2.5 text-sm text-foreground/85">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan/80" />
                            <span className="leading-relaxed">{d}</span>
                          </li>
                        ))}
                      </ul>
                    </Block>
                  )}

                  <Block label="EVIDENCE">
                    {evidence.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No files attached.</p>
                    ) : (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {evidence.map((f) => (
                          <li key={f.id}>
                            {f.evidence_type === "video" ||
                            (f.file_type ?? "").startsWith("video/") ? (
                              <EvidenceVideo row={f} />
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  const url = await getEvidenceUrl(f.file_url);
                                  if (url) window.open(url, "_blank", "noopener");
                                }}
                                className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:border-cyan/30"
                              >
                                <FileText className="h-4 w-4 shrink-0 text-cyan" />
                                <span className="min-w-0 flex-1 truncate text-sm">
                                  {f.file_name ?? "Attachment"}
                                </span>
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Block>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-soft rounded-xl p-4">
      <p className="mono-label text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="glass-soft mt-3 rounded-xl p-4">
      <p className="mono-label text-muted-foreground">{label}</p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}
