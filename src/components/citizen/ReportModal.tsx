import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Film,
  Image as ImageIcon,
  Send,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  reportCategories,
  reportCategoryAccent,
  type AiAnalysisResult,
  type ReportCategory,
} from "@/lib/citizen-data";
import { formatCoords, type SelectedLocation } from "@/lib/location";
import { LocationPicker } from "./LocationPicker";
import { VideoEvidence, type SelectedVideo, type VideoUploadStatus } from "./VideoEvidence";
import { SpeechToTextButton } from "./SpeechToText";
import { uploadVideoEvidence, videoErrorMessage } from "@/lib/video-evidence";

import { AiAnalysis } from "./AiAnalysis";
import {
  createChallenge,
  uploadChallengeEvidence,
  CHALLENGE_CREATED_EVENT,
  NotAuthenticatedError,
} from "@/lib/challenges-service";
import { useServerFn } from "@tanstack/react-start";
import { analyzeChallenge } from "@/lib/analysis.functions";
import { detectDuplicates, type DuplicateMatch } from "@/lib/duplicates.functions";
import { useLanguage } from "@/lib/i18n";
import { toAnalysisResult } from "@/lib/analysis-result";

import { cn } from "@/lib/utils";



const steps = [
  { no: "01", key: "IDENTIFY", heading: "What's happening?" },
  { no: "02", key: "LOCATION", heading: "Where is it happening?" },
  { no: "03", key: "EVIDENCE", heading: "Provide evidence" },
  { no: "04", key: "REVIEW", heading: "Review your mission" },
] as const;

const MAX_DESC = 600;

interface Evidence {
  id: string;
  name: string;
  kind: "photo" | "video" | "document";
  size: string;
  file: File;
}

/** Draft report — the single object sent to the backend on transmit. */

export interface ReportDraft {
  title: string;
  description: string;
  category: ReportCategory | null;
  location: SelectedLocation | null;
  evidence: Evidence[];
}

const emptyDraft: ReportDraft = {
  title: "",
  description: "",
  category: null,
  location: null,
  evidence: [],
};

function kindFor(file: File): Evidence["kind"] {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  return "document";
}



const kindIcon = { photo: ImageIcon, video: Film, document: FileText } as const;

export function ReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"form" | "transmit" | "analysis" | "failed">("form");
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState(false);
  const [analysis, setAnalysis] = useState<AiAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const { language } = useLanguage();
  const runAnalysis = useServerFn(analyzeChallenge);
  const runDuplicateCheck = useServerFn(detectDuplicates);


  const [draft, setDraft] = useState<ReportDraft>(emptyDraft);
  
  const [dragging, setDragging] = useState(false);
  const [video, setVideo] = useState<SelectedVideo | null>(null);
  const [videoStatus, setVideoStatus] = useState<VideoUploadStatus>("idle");
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const reset = () => {
    setStep(0);
    setPhase("form");
    setDraft(emptyDraft);
    setVideo(null);
    setVideoStatus("idle");
    setVideoProgress(0);
    setVideoError(null);
    setError(null);
    setReceived(false);
    setAnalysis(null);
    setAnalysisError(null);
    setChallengeId(null);
    setDuplicates([]);
  };

  /**
   * Advisory duplicate check. Runs after the report is already stored, so a
   * failure here can never block or reject the citizen's submission.
   */
  const checkDuplicates = async (id: string) => {
    try {
      setDuplicates(await runDuplicateCheck({ data: { challengeId: id, language } }));
    } catch (err) {
      console.error("[civicx] duplicate detection unavailable", err);
      setDuplicates([]);
    }
  };

  /** Runs the server-side AI analysis for a stored challenge. */
  const analyse = async (id: string) => {
    setAnalysis(null);
    setAnalysisError(null);
    setDuplicates([]);
    try {
      const result = await runAnalysis({ data: { challengeId: id, language } });
      setAnalysis(toAnalysisResult(result, id));
      window.dispatchEvent(new Event(CHALLENGE_CREATED_EVENT));
      void checkDuplicates(id);
    } catch (err) {
      console.error("[civicx] ai analysis failed", err);
      setAnalysisError(
        "Your challenge was saved, but AI analysis could not be completed. You can retry.",
      );
      window.dispatchEvent(new Event(CHALLENGE_CREATED_EVENT));
    }
  };



  const finish = () => {
    onClose();
    setTimeout(reset, 350);
  };


  const canAdvance =
    step === 0
      ? draft.title.trim().length > 2 && draft.description.trim().length > 9 && !!draft.category
      : step === 1
        ? !!draft.location
        : true;

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: Evidence[] = Array.from(files).map((f) => ({
      id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      kind: kindFor(f),
      size: `${Math.max(1, Math.round(f.size / 1024))} KB`,
      file: f,
    }));
    setDraft((d) => ({ ...d, evidence: [...d.evidence, ...next] }));
  };

  /** Field-level checks surfaced inside the review step. */
  const validate = (): string | null => {
    if (draft.title.trim().length < 3) return "Add a challenge title of at least 3 characters.";
    if (draft.description.trim().length < 10)
      return "Describe the problem in at least 10 characters.";
    if (!draft.category) return "Choose a category for this challenge.";
    if (!draft.location) return "Select the location where this is happening.";
    const { latitude: lat, longitude: lng } = draft.location;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return "The selected location has invalid coordinates.";
    return null;
  };

  /** Uploads the attached video (if any). Failures never lose the report. */
  const sendVideo = async (id: string) => {
    if (!video) return;
    setVideoStatus("uploading");
    setVideoProgress(0);
    setVideoError(null);
    try {
      await uploadVideoEvidence({
        challengeId: id,
        file: video.file,
        durationSeconds: video.durationSeconds,
        onProgress: setVideoProgress,
      });
      setVideoStatus("done");
    } catch (err) {
      console.error("[civicx] video evidence upload failed", err);
      setVideoStatus("failed");
      setVideoError(videoErrorMessage(err instanceof Error ? err.message : "UPLOAD_FAILED"));
    }
  };

  const transmit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setReceived(false);
    setPhase("transmit");

    try {
      const challenge = await createChallenge({
        title: draft.title.trim(),
        description: draft.description.trim(),
        category: draft.category,
        locationName: draft.location?.label ?? null,
        latitude: draft.location?.latitude ?? null,
        longitude: draft.location?.longitude ?? null,
        address: draft.location?.address ?? null,
        locality: draft.location?.locality ?? null,
        city: draft.location?.city ?? null,
        state: draft.location?.state ?? null,
        country: draft.location?.country ?? null,
      });

      if (draft.evidence.length > 0) {
        await uploadChallengeEvidence(
          challenge.id,
          draft.evidence.map((e) => e.file),
        );
      }

      await sendVideo(challenge.id);

      setChallengeId(challenge.id);
      window.dispatchEvent(new Event(CHALLENGE_CREATED_EVENT));
      setReceived(true);
      setTimeout(() => setPhase("analysis"), reduced ? 150 : 900);
      void analyse(challenge.id);

    } catch (err) {
      console.error("[civicx] challenge transmission failed", err);
      setError(
        err instanceof NotAuthenticatedError
          ? err.message
          : err instanceof Error && err.message.startsWith("We could not")
            ? err.message
            : "Your challenge could not be submitted. Please try again.",
      );
      setPhase("failed");
    }
  };



  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 bg-background/85 backdrop-blur-md"
          />

          <motion.div
            role="dialog"
            aria-label="Report a challenge"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="relative mx-auto my-6 w-[min(56rem,calc(100%-1.5rem))]"
          >
            <div className="glass grid-floor relative overflow-hidden rounded-[1.75rem] p-5 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="mono-label text-cyan/90">
                    CIVICX // {phase === "form" ? `STEP ${steps[step]!.no} — ${steps[step]!.key}` : "SIGNAL TRANSMISSION"}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                    {phase === "form"
                      ? steps[step]!.heading
                      : phase === "transmit"
                        ? received
                          ? "Signal received"
                          : "Transmitting…"
                        : phase === "failed"
                          ? "Transmission failed"
                          : "Signal received"}

                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close report flow"
                  className="rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {phase === "form" && (
                <>
                  {/* step rail */}
                  <div className="mt-6 flex items-center gap-2">
                    {steps.map((s, i) => (
                      <div key={s.key} className="flex flex-1 items-center gap-2">
                        <span
                          className={cn(
                            "font-mono text-[9px] tracking-[0.14em]",
                            i <= step ? "text-cyan" : "text-muted-foreground/60",
                          )}
                        >
                          {s.no}
                        </span>
                        <span className="relative h-px flex-1 bg-border">
                          <motion.span
                            className="absolute inset-y-0 left-0 block"
                            style={{ backgroundImage: "var(--gradient-accent)" }}
                            animate={{ width: i < step ? "100%" : i === step ? "45%" : "0%" }}
                            transition={{ duration: reduced ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.div
                      key={step}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="mt-7"
                    >
                      {step === 0 && (
                        <div className="space-y-5">
                          <Field label="CHALLENGE TITLE">
                            <input
                              value={draft.title}
                              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                              placeholder="Waste overflow near Rohini Sector 7"
                              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                            />
                            <SpeechToTextButton
                              onText={(text) =>
                                setDraft((d) => {
                                  const base = d.title.trimEnd();
                                  return { ...d, title: base ? `${base} ${text}` : text };
                                })
                              }
                            />
                          </Field>

                          <Field
                            label="DESCRIPTION"
                            hint={`${draft.description.length} / ${MAX_DESC}`}
                          >
                            <textarea
                              value={draft.description}
                              maxLength={MAX_DESC}
                              rows={5}
                              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                              placeholder="Describe what you see, how often it happens and who it affects."
                              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                            />
                            <SpeechToTextButton
                              onText={(text) =>
                                setDraft((d) => {
                                  const base = d.description.trimEnd();
                                  const next = (base ? `${base} ` : "") + text;
                                  return next.length <= MAX_DESC ? { ...d, description: next } : d;
                                })
                              }
                            />
                          </Field>

                          <div>
                            <p className="mono-label text-muted-foreground">CATEGORY</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {reportCategories.map((c) => {
                                const active = draft.category === c;
                                const accent = reportCategoryAccent[c];
                                return (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => setDraft((d) => ({ ...d, category: c }))}
                                    className={cn(
                                      "rounded-xl border px-3 py-2 font-mono text-[10px] tracking-[0.14em] transition-colors",
                                      active
                                        ? "text-foreground"
                                        : "border-border text-muted-foreground hover:text-foreground",
                                    )}
                                    style={
                                      active
                                        ? {
                                            borderColor: `color-mix(in oklab, ${accent} 50%, transparent)`,
                                            backgroundColor: `color-mix(in oklab, ${accent} 12%, transparent)`,
                                          }
                                        : undefined
                                    }
                                  >
                                    <span
                                      className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle"
                                      style={{ backgroundColor: accent }}
                                    />
                                    {c.toUpperCase()}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {step === 1 && (
                        <LocationPicker
                          value={draft.location}
                          onChange={(location) => setDraft((d) => ({ ...d, location }))}
                          onConfirm={() => draft.location && setStep(2)}
                        />
                      )}


                      {step === 2 && (
                        <div className="space-y-4">
                          <div
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragging(false);
                              addFiles(e.dataTransfer.files);
                            }}
                            className={cn(
                              "rounded-2xl border border-dashed px-6 py-10 text-center transition-colors",
                              dragging ? "border-cyan/60 bg-cyan/5" : "border-border",
                            )}
                          >
                            <UploadCloud className="mx-auto h-7 w-7 text-cyan" />
                            <p className="mt-3 text-sm">Drag photos, video or documents here</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Evidence stays on this device in the demo build.
                            </p>
                            <button
                              type="button"
                              onClick={() => fileInput.current?.click()}
                              className="mt-4 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-cyan"
                            >
                              BROWSE FILES
                            </button>
                            <input
                              ref={fileInput}
                              type="file"
                              multiple
                              className="hidden"
                              onChange={(e) => addFiles(e.target.files)}
                            />
                          </div>

                          <VideoEvidence
                            value={video}
                            onChange={setVideo}
                            status={videoStatus}
                            progress={videoProgress}
                            errorMessage={videoError}
                            onRetry={() => challengeId && void sendVideo(challengeId)}
                          />

                          {draft.evidence.length > 0 && (
                            <div className="grid gap-2 sm:grid-cols-2">
                              {draft.evidence.map((f) => {
                                const Icon = kindIcon[f.kind];
                                return (
                                  <motion.div
                                    key={f.id}
                                    initial={reduced ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="glass-soft flex items-center gap-3 rounded-xl px-3 py-2.5"
                                  >
                                    <Icon className="h-4 w-4 shrink-0 text-cyan" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm">{f.name}</span>
                                      <span className="block font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
                                        {f.kind.toUpperCase()} • {f.size}
                                      </span>
                                    </span>
                                    <button
                                      type="button"
                                      aria-label={`Remove ${f.name}`}
                                      onClick={() =>
                                        setDraft((d) => ({
                                          ...d,
                                          evidence: d.evidence.filter((x) => x.id !== f.id),
                                        }))
                                      }
                                      className="text-muted-foreground transition-colors hover:text-destructive"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </motion.div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {step === 3 && (
                        <div className="space-y-3">
                          <Summary label="MISSION TITLE" value={draft.title || "—"} />
                          <Summary label="CATEGORY" value={draft.category ?? "—"} />
                          <Summary
                            label="LOCATION"
                            value={
                              draft.location
                                ? `${draft.location.label} · ${formatCoords(draft.location.latitude, draft.location.longitude)}`
                                : "—"
                            }
                          />
                          <Summary label="DESCRIPTION" value={draft.description || "—"} />
                          <Summary
                            label="EVIDENCE"
                            value={
                              draft.evidence.length
                                ? [...draft.evidence.map((f) => f.name), ...(video ? [video.name] : [])].join(", ")
                                : video
                                  ? video.name
                                  : "No files attached"
                            }
                          />

                          <div className="pt-4 text-center">
                            <p className="font-mono text-sm tracking-[0.18em] text-cyan">
                              Ready to transmit?
                            </p>
                            {error && (
                              <p className="mx-auto mt-3 max-w-md text-xs text-destructive">
                                {error}
                              </p>
                            )}
                            <motion.button
                              type="button"
                              onClick={() => void transmit()}
                              whileHover={reduced ? {} : { y: -2 }}
                              whileTap={{ scale: 0.98 }}
                              className="mt-4 inline-flex items-center gap-2 rounded-xl px-6 py-3 font-mono text-[11px] font-semibold tracking-[0.18em] text-background motion-reduce:transform-none"
                              style={{ backgroundImage: "var(--gradient-accent)" }}
                            >
                              TRANSMIT CHALLENGE
                              <ArrowRight className="h-4 w-4" />
                            </motion.button>
                          </div>

                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>

                  {step < 3 && (
                    <div className="mt-8 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setStep((s) => Math.max(0, s - 1))}
                        disabled={step === 0}
                        className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        BACK
                      </button>
                      <button
                        type="button"
                        onClick={() => canAdvance && setStep((s) => Math.min(3, s + 1))}
                        disabled={!canAdvance}
                        className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-mono text-[10px] font-semibold tracking-[0.16em] text-background disabled:opacity-40"
                        style={{ backgroundImage: "var(--gradient-accent)" }}
                      >
                        CONTINUE
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {step === 3 && (
                    <div className="mt-6">
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        BACK
                      </button>
                    </div>
                  )}
                </>
              )}

              {phase === "transmit" && (
                <div className="grid place-items-center py-16">
                  <span className="relative grid h-24 w-24 place-items-center">
                    <motion.span
                      className="absolute inset-0 rounded-full border border-cyan/40"
                      animate={reduced ? {} : { scale: [1, 1.6], opacity: [0.8, 0] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                    />
                    <motion.span
                      className="absolute inset-0 rounded-full border border-violet/40"
                      animate={reduced ? {} : { scale: [1, 1.9], opacity: [0.6, 0] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: 0.35, ease: "easeOut" }}
                    />
                    <span
                      className="grid h-14 w-14 place-items-center rounded-full text-background"
                      style={{ backgroundImage: "var(--gradient-accent)" }}
                    >
                      <Send className="h-5 w-5" />
                    </span>
                  </span>
                  <p className="mt-8 font-mono text-[11px] tracking-[0.28em] text-cyan">
                    {received ? "SIGNAL RECEIVED" : "TRANSMITTING CIVIC SIGNAL"}
                  </p>
                  <p className="mt-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
                    ROUTING TO CIVICX INTELLIGENCE
                  </p>
                </div>
              )}

              {phase === "failed" && (
                <div className="grid place-items-center py-16 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-full border border-destructive/40 bg-destructive/10">
                    <X className="h-5 w-5 text-destructive" />
                  </span>
                  <p className="mt-6 font-mono text-[11px] tracking-[0.28em] text-destructive">
                    TRANSMISSION FAILED
                  </p>
                  <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                    {error ?? "Your challenge could not be submitted. Please try again."}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => void transmit()}
                      className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-mono text-[10px] font-semibold tracking-[0.16em] text-background"
                      style={{ backgroundImage: "var(--gradient-accent)" }}
                    >
                      RETRY TRANSMISSION
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPhase("form");
                        setStep(3);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      BACK TO REVIEW
                    </button>
                  </div>
                </div>
              )}

              {phase === "analysis" && (
                <div className="mt-8">
                  <AiAnalysis
                    {...(analysis ? { result: analysis } : {})}
                    {...(analysisError ? { error: analysisError } : {})}
                    {...(challengeId ? { onRetry: () => void analyse(challengeId) } : {})}
                    challengeId={challengeId}
                    duplicates={duplicates}
                    onCreateMission={finish}

                  />

                </div>
              )}

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between">
        <span className="mono-label text-muted-foreground">{label}</span>
        {hint && (
          <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground/70">
            {hint}
          </span>
        )}
      </span>
      <span className="glass-soft mt-2 block rounded-xl px-3 py-2.5 focus-within:border-cyan/40">
        {children}
      </span>
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-soft rounded-xl px-4 py-3">
      <p className="mono-label text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{value}</p>
    </div>
  );
}
