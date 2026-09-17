import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useServerFn } from "@tanstack/react-start";
import { Brain, Minus, RotateCcw, Send, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/lib/auth-context";
import { useAssistantContext } from "@/lib/assistant-context";
import { askCivicxAi } from "@/lib/assistant.functions";
import { useLanguage } from "@/lib/i18n";
import type { RoleId } from "@/lib/civicx-roles";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  failed?: boolean;
}

const GREETING = `Hi! I'm CivicX AI 👋

I can help you understand CivicX, your missions, proposals, teams, collaborations, and more.

What would you like to know?`;

const suggestionsByRole: Record<RoleId, string[]> = {
  citizen: [
    "How do I report a civic problem?",
    "What happens after I submit a report?",
    "How does CivicX prioritize challenges?",
  ],
  university: [
    "How do I join a solution team?",
    "What skills are required for this mission?",
    "How does team matching work?",
    "How do I submit a proposal?",
  ],
  industry: [
    "How can I collaborate with a university team?",
    "What does the AI feasibility review mean?",
    "How do I express interest in a solution?",
  ],
  government: [
    "How do I monitor civic challenges?",
    "How does CivicX track project progress?",
    "How can I identify high-priority problems?",
  ],
};

const clock = (at: number) =>
  new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

const newId = () => Math.random().toString(36).slice(2);

/** Renders an assistant answer, keeping the model's light markdown readable. */
function AnswerBody({ text }: { text: string }) {
  return (
    <div className="space-y-2 [&_a]:text-cyan [&_a]:underline [&_code]:font-mono [&_code]:text-xs [&_li]:ml-4 [&_li]:list-disc [&_ol>li]:list-decimal [&_strong]:font-semibold [&_strong]:text-foreground">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

/**
 * Floating CivicX AI assistant. Every answer comes from the server-side model
 * call, which reads only what the signed-in operator is already allowed to see.
 */
export function CivicxAssistant() {
  const { currentUser, role } = useAuth();
  const { focus } = useAssistantContext();
  const reduced = useReducedMotion() ?? false;
  const { language } = useLanguage();
  const ask = useServerFn(askCivicxAi);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastQuestion = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo(() => suggestionsByRole[role ?? "citizen"], [role]);

  useEffect(() => {
    if (!scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, busy, open]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;

      lastQuestion.current = text;
      setError(null);
      setDraft("");

      const history = messages
        .filter((m) => !m.failed)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", content: text, at: Date.now() },
      ]);
      setBusy(true);

      try {
        const result = await ask({
          data: {
            question: text,
            history,
            language,
            focus: {
              missionId: focus.missionId ?? null,
              teamId: focus.teamId ?? null,
              proposalId: focus.proposalId ?? null,
            },
          },
        });
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "assistant", content: result.answer, at: Date.now() },
        ]);
      } catch (err) {
        console.error("[civicx] assistant question failed", err);
        setError("CivicX AI is temporarily unavailable. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [ask, busy, focus.missionId, focus.proposalId, focus.teamId, messages],
  );

  const retry = useCallback(() => {
    const question = lastQuestion.current;
    if (!question || busy) return;
    // Drop the unanswered question so it is not sent twice in the history.
    setMessages((prev) => {
      const next = [...prev];
      while (next.length > 0 && next[next.length - 1]?.role === "user") next.pop();
      return next;
    });
    void send(question);
  }, [busy, send]);

  const reset = useCallback(() => {
    setMessages([]);
    setDraft("");
    setError(null);
    lastQuestion.current = null;
  }, []);

  if (!currentUser) return null;

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            key="launcher"
            onClick={() => setOpen(true)}
            initial={reduced ? false : { opacity: 0, y: 12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? {} : { opacity: 0, y: 12, scale: 0.94 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="glass fixed bottom-5 right-5 z-[120] flex items-center gap-2.5 rounded-2xl border border-cyan/30 px-4 py-3 shadow-[0_0_32px_-8px_hsl(var(--cyan)/0.45)] transition-transform hover:-translate-y-0.5"
          >
            <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-cyan/15">
              <Brain className="h-4 w-4 text-cyan" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-cyan" />
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-foreground">
              ASK CIVICX AI
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.aside
            key="panel"
            initial={reduced ? false : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? {} : { opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="glass fixed bottom-4 right-4 z-[120] flex h-[min(38rem,calc(100vh-2rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-cyan/25 shadow-[0_0_48px_-12px_hsl(var(--cyan)/0.4)]"
          >
            <header className="flex items-start gap-3 border-b border-border/70 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet/15">
                <Sparkles className="h-4 w-4 text-violet" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">CivicX AI</p>
                <p className="truncate text-xs text-muted-foreground">Your CivicX assistant</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="mono-label flex items-center gap-1.5 rounded-lg border border-cyan/30 px-2 py-1 text-cyan">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
                  AI ONLINE
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Minimize CivicX AI"
                  className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            </header>

            <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <div className="glass-soft rounded-xl rounded-tl-sm p-3 text-sm leading-relaxed whitespace-pre-line">
                {GREETING}
              </div>

              {messages.length === 0 && (
                <div className="space-y-2 pt-1">
                  <p className="mono-label text-muted-foreground">SUGGESTED</p>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="block w-full rounded-xl border border-border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-cyan/40 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-xl rounded-br-sm border border-cyan/25 bg-cyan/10 px-3 py-2 text-sm leading-relaxed"
                        : "glass-soft max-w-[92%] rounded-xl rounded-tl-sm px-3 py-2 text-sm leading-relaxed"
                    }
                  >
                    {m.role === "assistant" ? <AnswerBody text={m.content} /> : m.content}
                    <p className="mono-label mt-1.5 text-muted-foreground/70">{clock(m.at)}</p>
                  </div>
                </div>
              ))}

              {busy && (
                <div className="glass-soft inline-flex items-center gap-1.5 rounded-xl rounded-tl-sm px-3 py-2.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                  <span className="mono-label ml-1 text-muted-foreground">THINKING</span>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5">
                  <p className="text-xs text-foreground">{error}</p>
                  <button
                    type="button"
                    onClick={retry}
                    className="mono-label mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                    RETRY
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-border/70 px-3 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                  rows={1}
                  placeholder="Ask CivicX AI anything…"
                  className="max-h-24 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-cyan/50"
                />
                <button
                  type="button"
                  onClick={() => void send(draft)}
                  disabled={busy || draft.trim().length === 0}
                  aria-label="Send"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan/35 bg-cyan/15 text-cyan transition-opacity disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy || messages.length === 0}
                  className="mono-label inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <X className="h-3 w-3" />
                  NEW CHAT
                </button>
                <p className="mono-label text-muted-foreground/70">ENTER TO SEND</p>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
