/**
 * Server-only entry point for every CivicX Gemini call.
 *
 * CivicX talks to `google/gemini-3.6-flash`. In the Lovable
 * environment it does so through the Lovable AI Gateway, authenticated with the
 * platform-managed `LOVABLE_API_KEY`. That secret only exists inside Lovable
 * hosting, so a deployment to a third-party host (Vercel) has no credential at
 * all and every AI feature fails with "temporarily unavailable".
 *
 * This module keeps the existing gateway path exactly as it was and adds a
 * direct Google Generative Language fallback used only when the host provides
 * its own `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Same model, same prompts,
 * same returned text — only the transport differs.
 *
 * Keys are read from `process.env` inside the call, never bundled, never
 * logged, never exposed to the browser.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "google/gemini-3.6-flash";
const GOOGLE_MODEL = "gemini-3.6-flash";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Interface language of the operator making the request. */
export type AiLanguage = "en" | "hi";

/**
 * Language contract appended to every CivicX system prompt.
 *
 * Only human-readable wording follows the operator's language. JSON keys,
 * enum values, statuses and ids stay in their exact internal English form so
 * the stored data and workflow logic never change.
 */
export function languageDirective(language: AiLanguage): string {
  const chosen = language === "hi" ? "Hindi (हिंदी, Devanagari script)" : "English";
  return `RESPONSE LANGUAGE (strict):
- The operator's chosen CivicX interface language is ${chosen}. Write every human-readable sentence, summary, label text, reason and recommendation in that language.
- Follow the user's own writing when it differs: text written in English gets an English answer; text written in Hindi gets a Hindi answer in Devanagari; text written in Hinglish (Hindi typed in Latin letters, or mixed Hindi-English) must be understood and answered in natural conversational Hindi, keeping the common English words people actually use.
- Keep simple, everyday wording. Do not use rare or heavily Sanskritised Hindi.
- NEVER translate machine values: JSON keys, enum values (for example REPORTED, AI_ANALYSIS, AI_ANALYSIS_COMPLETE, FAILED, LOW, MEDIUM, HIGH, CRITICAL, NORMAL, SAME_ISSUE, POSSIBLE_DUPLICATE, DIFFERENT_ISSUE, LINK_TO_EXISTING, REVIEW, KEEP_SEPARATE, PRIMARY, NONE), field names, uuids, ids, urls, numbers and the brand name CivicX. These stay exactly as specified, in English.
- If the output format is JSON, keep the structure and the enum values identical and translate only the free-text values.`;
}

type Provider = "lovable-gateway" | "google-direct";

export interface AiConfigStatus {
  provider: Provider | null;
  hasLovableKey: boolean;
  hasGoogleKey: boolean;
}

/** Which credential the process can see. Never returns a key value. */
export function describeAiConfig(): AiConfigStatus {
  const hasLovableKey = Boolean(process.env["LOVABLE_API_KEY"]);
  const hasGoogleKey = Boolean(
    process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"],
  );
  return {
    provider: hasLovableKey ? "lovable-gateway" : hasGoogleKey ? "google-direct" : null,
    hasLovableKey,
    hasGoogleKey,
  };
}

export class AiCredentialMissingError extends Error {
  constructor() {
    super(
      "No AI credential is configured on the server. Set LOVABLE_API_KEY (Lovable hosting) or GEMINI_API_KEY (self-hosted deployment).",
    );
    this.name = "AiCredentialMissingError";
  }
}

function log(feature: string, message: string, extra?: unknown): void {
  if (extra === undefined) console.info(`[civicx][ai][${feature}] ${message}`);
  else console.info(`[civicx][ai][${feature}] ${message}`, extra);
}

async function viaGateway(
  apiKey: string,
  feature: string,
  system: string,
  turns: ChatTurn[],
): Promise<string> {
  log(feature, "gemini request started via lovable gateway");
  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, ...turns],
    }),
  });

  log(feature, `gemini response status ${response.status}`);
  if (!response.ok) {
    throw new Error(`AI request failed [${response.status}]: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response contained no content");
  return content;
}

async function viaGoogle(
  apiKey: string,
  feature: string,
  system: string,
  turns: ChatTurn[],
): Promise<string> {
  log(feature, "gemini request started via google generative language api");
  const response = await fetch(
    `${GOOGLE_URL}/${GOOGLE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({
          role: t.role === "assistant" ? "model" : "user",
          parts: [{ text: t.content }],
        })),
      }),
    },
  );

  log(feature, `gemini response status ${response.status}`);
  if (!response.ok) {
    throw new Error(`AI request failed [${response.status}]: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!content) throw new Error("AI response contained no content");
  return content;
}

/**
 * Runs one Gemini chat completion and returns the raw assistant text.
 * Throws `AiCredentialMissingError` when the host has no AI credential, and a
 * descriptive `Error` for transport/model failures. Callers keep their own
 * user-facing error types.
 */
export async function callGemini(options: {
  /** Short feature tag used in diagnostic logs, e.g. "assistant". */
  feature: string;
  system: string;
  /** Either a single user prompt, or a full conversation. */
  prompt?: string;
  turns?: ChatTurn[];
  /** Interface language chosen by the operator. Defaults to English. */
  language?: AiLanguage;
}): Promise<string> {
  const { feature } = options;
  const system = `${options.system}\n\n${languageDirective(options.language ?? "en")}`;
  const turns: ChatTurn[] = options.turns?.length
    ? options.turns
    : [{ role: "user", content: options.prompt ?? "" }];

  const config = describeAiConfig();
  log(
    feature,
    `credential check: lovable=${config.hasLovableKey ? "present" : "missing"} google=${config.hasGoogleKey ? "present" : "missing"}`,
  );

  if (!config.provider) {
    console.error(
      `[civicx][ai][${feature}] no AI credential configured — set LOVABLE_API_KEY or GEMINI_API_KEY on the server`,
    );
    throw new AiCredentialMissingError();
  }

  try {
    const text =
      config.provider === "lovable-gateway"
        ? await viaGateway(process.env["LOVABLE_API_KEY"]!, feature, system, turns)
        : await viaGoogle(
            (process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"])!,
            feature,
            system,
            turns,
          );
    log(feature, `gemini response received (${text.length} chars)`);
    return text;
  } catch (err) {
    console.error(`[civicx][ai][${feature}] gemini request failed`, err);
    throw err;
  }
}
