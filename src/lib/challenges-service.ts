/**
 * CivicX data layer.
 *
 * All database access for challenges goes through this module so components
 * never talk to the backend directly. Every call uses the authenticated user's
 * session, so the existing Row Level Security policies apply unchanged.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type {
  ChallengeCategory,
  ChallengeNode,
  MissionStatus,
  Priority,
} from "@/lib/civicx-data";
import type { CitizenMission } from "@/lib/citizen-data";

export type ChallengeRow = Database["public"]["Tables"]["challenges"]["Row"];
export type ChallengeStatusRow =
  Database["public"]["Tables"]["challenge_status_history"]["Row"];
export type EvidenceRow = Database["public"]["Tables"]["challenge_evidence"]["Row"];

export const EVIDENCE_BUCKET = "challenge-evidence";

/** Fired after a challenge is stored so open lists can refresh themselves. */
export const CHALLENGE_CREATED_EVENT = "civicx:challenge-created";

export class NotAuthenticatedError extends Error {
  constructor() {
    super("You need to be signed in to report a challenge.");
    this.name = "NotAuthenticatedError";
  }
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new NotAuthenticatedError();
  return data.user.id;
}

async function optionalUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export interface NewChallenge {
  title: string;
  description: string;
  category: string | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

/** Insert a challenge plus its first status-history entry. */
export async function createChallenge(input: NewChallenge): Promise<ChallengeRow> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("challenges")
    .insert({
      created_by: userId,
      title: input.title,
      description: input.description,
      category: input.category,
      location_name: input.locationName,
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address ?? null,
      locality: input.locality ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? null,
      priority: "MEDIUM",
      status: "REPORTED",
    })
    .select()
    .single();


  if (error) throw error;

  const history = await supabase
    .from("challenge_status_history")
    .insert({
      challenge_id: data.id,
      status: "REPORTED",
      message: "Challenge submitted by citizen",
    });

  if (history.error) throw history.error;

  return data;
}

/** Upload each attached file, then record it against the challenge. */
export async function uploadChallengeEvidence(
  challengeId: string,
  files: File[],
): Promise<EvidenceRow[]> {
  if (files.length === 0) return [];
  const userId = await requireUserId();
  const rows: EvidenceRow[] = [];

  for (const file of files) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${userId}/${challengeId}/${Date.now()}-${safeName}`;

    const upload = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream" });

    if (upload.error) {
      console.error("[civicx] evidence upload failed", upload.error);
      throw new Error(`We could not upload "${file.name}".`);
    }

    const { data, error } = await supabase
      .from("challenge_evidence")
      .insert({
        challenge_id: challengeId,
        file_url: path,
        file_type: file.type || null,
        file_name: file.name,
        evidence_type: file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("video/")
            ? "video"
            : "document",
        file_size: file.size,
        uploaded_by: userId,
      })
      .select()
      .single();

    if (error) {
      console.error("[civicx] evidence record failed", error);
      throw new Error(`We could not save the record for "${file.name}".`);
    }
    rows.push(data);
  }

  return rows;
}

/** Short-lived link for a private evidence object. */
export async function getEvidenceUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error) {
    console.error("[civicx] signed url failed", error);
    return null;
  }
  return data.signedUrl;
}

/** All challenges the current session is allowed to read. */
export async function getChallenges(): Promise<ChallengeRow[]> {
  if (!(await optionalUserId())) return [];

  const { data, error } = await supabase
    .from("challenges")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** Challenges reported by the current citizen, newest first. */
export async function getMyChallenges(): Promise<ChallengeRow[]> {
  const userId = await optionalUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("challenges")
    .select("*")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getChallengeById(id: string): Promise<ChallengeRow | null> {
  if (!(await optionalUserId())) return null;

  const { data, error } = await supabase
    .from("challenges")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getChallengeStatusHistory(
  challengeId: string,
): Promise<ChallengeStatusRow[]> {
  if (!(await optionalUserId())) return [];

  const { data, error } = await supabase
    .from("challenge_status_history")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getChallengeEvidence(challengeId: string): Promise<EvidenceRow[]> {
  if (!(await optionalUserId())) return [];

  const { data, error } = await supabase
    .from("challenge_evidence")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/* ---------- presentation mapping (keeps the existing UI contract) ---------- */

export const statusMap: Record<string, MissionStatus> = {
  REPORTED: "SIGNAL DETECTED",
  AI_ANALYSIS: "SIGNAL DETECTED",
  AI_ANALYSIS_FAILED: "SIGNAL DETECTED",
  AI_ANALYSIS_COMPLETE: "AI ANALYSIS COMPLETE",
  "AI ANALYSIS": "AI ANALYSIS COMPLETE",
  MATCHING: "MATCHING IN PROGRESS",
  TEAM_FORMING: "MATCHING IN PROGRESS",
  TEAM_FORMED: "TEAM FOUND",
  COLLABORATION: "MISSION ACTIVE",
  IMPACT: "MISSION COMPLETED",
};

const progressMap: Record<MissionStatus, number> = {
  "SIGNAL DETECTED": 10,
  "AI ANALYSIS COMPLETE": 20,
  "MATCHING IN PROGRESS": 45,
  "TEAM FOUND": 60,
  "INDUSTRY SUPPORT AVAILABLE": 70,
  "MISSION ACTIVE": 85,
  "MISSION COMPLETED": 100,
};

function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** Map a database row onto the mission card shape the UI already renders. */
export function toCitizenMission(row: ChallengeRow): CitizenMission {
  const status = statusMap[row.status] ?? "SIGNAL DETECTED";
  return {
    id: row.id,
    code: `MISSION #${row.id.slice(0, 4).toUpperCase()}`,
    title: row.title,
    location: row.location_name ?? "Location pending",
    priority: (row.priority as Priority) ?? "MEDIUM",
    status,
    progress: progressMap[status],
    reported: relativeTime(row.created_at),
  };
}

/* ---------- map projection (live challenge nodes) ---------- */

/** Rough India bounding box used to project coordinates onto the canvas. */
const BOUNDS = { minLat: 6, maxLat: 37, minLng: 68, maxLng: 98 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const categoryLookup: Record<string, ChallengeCategory> = {
  WATER: "Water",
  WASTE: "Waste",
  "WASTE MANAGEMENT": "Waste",
  EDUCATION: "Education",
  HEALTHCARE: "Healthcare",
  HEALTH: "Healthcare",
  INFRASTRUCTURE: "Infrastructure",
  "PUBLIC SAFETY": "Safety",
  SAFETY: "Safety",
  ENVIRONMENT: "Waste",
};

/** Best-effort mapping of a free-text category onto the visual category set. */
export function toChallengeCategory(raw: string | null): ChallengeCategory {
  if (!raw) return "Infrastructure";
  const key = raw.trim().toUpperCase();
  if (categoryLookup[key]) return categoryLookup[key];
  const hit = Object.keys(categoryLookup).find((k) => key.includes(k));
  return hit ? categoryLookup[hit]! : "Infrastructure";
}

/** True when a row can be placed on the map. */
export function hasCoordinates(row: ChallengeRow): boolean {
  return (
    typeof row.latitude === "number" &&
    typeof row.longitude === "number" &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude) &&
    Math.abs(row.latitude) <= 90 &&
    Math.abs(row.longitude) <= 180
  );
}

/** Map a stored challenge onto the existing visual node shape. */
export function toChallengeNode(row: ChallengeRow, index = 0): ChallengeNode {
  const lat = row.latitude ?? 0;
  const lng = row.longitude ?? 0;
  const rawX = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * 100;
  const rawY = ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100;
  // nudge overlapping reports apart so nearby nodes stay clickable
  const jitter = ((index % 5) - 2) * 1.6;

  return {
    id: row.id,
    code: `MISSION #${row.id.slice(0, 4).toUpperCase()}`,
    name: row.title,
    location: row.location_name ?? "Location pending",
    category: toChallengeCategory(row.category),
    priority: (row.priority as Priority) ?? "MEDIUM",
    affected:
      row.estimated_impact !== null && row.estimated_impact !== undefined
        ? row.estimated_impact.toLocaleString()
        : "",
    status: statusMap[row.status] ?? "SIGNAL DETECTED",
    confidence: row.ai_confidence !== null ? Math.round(Number(row.ai_confidence)) : 0,
    description: row.description,
    aiAnalysis: row.ai_summary ?? "AI analysis pending for this signal.",
    skills: row.recommended_skills ?? [],
    stakeholders: row.affected_stakeholders ?? [],
    directions: row.solution_directions ?? [],
    live: true,
    x: clamp(rawX + jitter, 6, 94),
    y: clamp(rawY + jitter, 8, 92),
  };
}

/**
 * Challenges with usable coordinates, ready for the map.
 * Reports linked to a canonical challenge are collapsed into that single pin,
 * so one underlying problem never shows up as a cluster of duplicates.
 */
export async function getMapChallenges(): Promise<ChallengeRow[]> {
  const rows = await getChallenges();
  return rows.filter((row) => hasCoordinates(row) && !row.canonical_challenge_id);
}

/**
 * Realtime INSERT subscription on `challenges`.
 * Rows still pass through RLS, so a citizen only receives their own signals.
 */
export function subscribeToNewChallenges(onInsert: (row: ChallengeRow) => void) {
  const channel = supabase
    .channel("civicx-challenges")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "challenges" },
      (payload) => onInsert(payload.new as ChallengeRow),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
