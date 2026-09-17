/**
 * Browser speech-to-text for the citizen report form.
 *
 * Uses the native Web Speech API only — no audio ever leaves the browser.
 * Recognised text is appended to the existing description via `onText`, so
 * anything the user already typed is preserved and stays fully editable.
 */

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useLanguage, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Status = "idle" | "listening" | "error";

interface RecognitionResultItem {
  transcript: string;
}

interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionResultItem;
}

interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}

interface RecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"] ?? null) as SpeechRecognitionCtor | null;
}

export function speechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export function SpeechToTextButton({
  onText,
  disabled,
}: {
  /** Append recognised speech to the current description. */
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { language } = useLanguage();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppingRef = useRef(false);

  const supported = speechRecognitionSupported();

  useEffect(
    () => () => {
      stoppingRef.current = true;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  const stop = () => {
    stoppingRef.current = true;
    recognitionRef.current?.stop();
  };

  const start = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("error");
      setMessage(t("Speech input isn't supported in this browser. You can type your report instead."));
      return;
    }
    setMessage(null);
    stoppingRef.current = false;

    const recognition = new Ctor();
    recognitionRef.current = recognition;
    recognition.lang = language === "hi" ? "hi-IN" : "en-IN";
    recognition.continuous = true;
    recognition.interimResults = false; // final results only — no interim duplication

    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) text += result[0]?.transcript ?? "";
      }
      text = text.trim();
      if (text) onText(text);
    };

    recognition.onerror = (event) => {
      const code = event?.error ?? "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        setMessage(t("Microphone permission denied. Allow microphone access and try again."));
      } else if (code === "no-speech") {
        setMessage(t("No speech detected. Try again."));
      } else if (code !== "aborted") {
        setMessage(t("Speech recognition failed. Try again."));
      }
      setStatus("error");
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus((current) => (current === "listening" ? (message ? "error" : "idle") : current));
      if (!stoppingRef.current && !message) setStatus("idle");
    };

    try {
      recognition.start();
      setStatus("listening");
    } catch {
      setStatus("error");
      setMessage(t("Speech recognition failed. Try again."));
      recognitionRef.current = null;
    }
  };

  if (!supported) {
    return (
      <p className="mt-2 font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
        {t("Speech input isn't supported in this browser. You can type your report instead.")}
      </p>
    );
  }

  const listening = status === "listening";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={listening ? stop : start}
        aria-label={listening ? t("Stop speaking") : t("Speak")}
        aria-pressed={listening}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 font-mono text-[10px] tracking-[0.14em] transition-colors disabled:opacity-50",
          listening
            ? "border-destructive/50 bg-destructive/10 text-foreground"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        {listening ? (
          <>
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-destructive" />
            </span>
            <Square className="size-3.5" aria-hidden />
            {t("Listening… Tap to stop")}
          </>
        ) : (
          <>
            <Mic className="size-3.5" aria-hidden />
            {t("Speak")}
          </>
        )}
      </button>
      {status === "error" && message && (
        <span role="alert" className="text-xs text-destructive">
          {message}
        </span>
      )}
    </div>
  );
}
