/**
 * Video evidence support for CivicX reports.
 *
 * Videos go straight from the browser into the existing private
 * `challenge-evidence` bucket. Anything larger than a single request can
 * comfortably carry is uploaded with Supabase Storage's resumable (TUS)
 * endpoint, so a dropped connection can pick up where it stopped. Only the
 * storage path and a little metadata are written to the database — the video
 * bytes never touch Postgres and are never base64 encoded.
 */

import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { EVIDENCE_BUCKET, type EvidenceRow } from "@/lib/challenges-service";

/** Formats the browser can generally play back. */
export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "video/x-matroska",
];

export const VIDEO_ACCEPT_ATTR = "video/mp4,video/webm,video/quicktime,video/ogg,video/*";

/** Upper bound we accept in the browser. Storage limits still apply server side. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Below this we use a plain upload; above it the resumable endpoint. */
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;
const CHUNK_SIZE = 6 * 1024 * 1024;

export type VideoValidationError = "type" | "size" | null;

export function validateVideoFile(file: File): VideoValidationError {
  const type = (file.type || "").toLowerCase();
  const looksLikeVideo = type.startsWith("video/");
  if (!looksLikeVideo || (ACCEPTED_VIDEO_TYPES.length > 0 && !type.startsWith("video/")))
    return "type";
  if (file.size > MAX_VIDEO_BYTES) return "size";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Best-effort duration read from a local object URL. Never throws. */
export function probeVideoDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement("video");
      el.preload = "metadata";
      const done = (value: number | null) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      el.onloadedmetadata = () =>
        done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
      el.onerror = () => done(null);
      el.src = url;
      window.setTimeout(() => done(null), 8000);
    } catch {
      resolve(null);
    }
  });
}

/** Safe, unique object name inside the bucket. */
function safeObjectName(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, "_").slice(-80) || "video";
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${unique}-${cleaned}`;
}

function storageBaseUrl(): string {
  const url =
    (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ??
    (typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined);
  if (!url) throw new Error("STORAGE_UNAVAILABLE");
  return `${url.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

export interface VideoUploadOptions {
  challengeId: string;
  file: File;
  fileName?: string;
  durationSeconds?: number | null;
  onProgress?: (percent: number) => void;
}

/** Uploads one video and records it against the challenge. */
export async function uploadVideoEvidence({
  challengeId,
  file,
  fileName,
  durationSeconds,
  onProgress,
}: VideoUploadOptions): Promise<EvidenceRow> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("UNAUTHORIZED");

  const name = fileName ?? file.name ?? "video.webm";
  const path = `${userId}/${challengeId}/videos/${safeObjectName(name)}`;
  const contentType = file.type || "video/webm";

  onProgress?.(0);

  if (file.size > RESUMABLE_THRESHOLD) {
    await resumableUpload(path, file, contentType, onProgress);
  } else {
    const { error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, file, { contentType, upsert: false });
    if (error) {
      console.error("[civicx] video upload failed", error);
      throw new Error(mapStorageError(error.message));
    }
    onProgress?.(100);
  }

  const duration =
    durationSeconds ?? (await probeVideoDuration(file).catch(() => null)) ?? null;

  const { data, error } = await supabase
    .from("challenge_evidence")
    .insert({
      challenge_id: challengeId,
      file_url: path,
      file_type: contentType,
      file_name: name,
      evidence_type: "video",
      file_size: file.size,
      duration_seconds: duration,
      uploaded_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error("[civicx] video evidence record failed", error);
    throw new Error("RECORD_FAILED");
  }
  return data as EvidenceRow;
}

function mapStorageError(message: string): string {
  const lower = (message || "").toLowerCase();
  if (lower.includes("exceeded") || lower.includes("maximum allowed size") || lower.includes("413"))
    return "STORAGE_LIMIT";
  if (lower.includes("unauthorized") || lower.includes("row-level") || lower.includes("403"))
    return "UNAUTHORIZED";
  return "UPLOAD_FAILED";
}

/** Chunked, resumable upload through Supabase Storage's TUS endpoint. */
function resumableUpload(
  path: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        reject(new Error("UNAUTHORIZED"));
        return;
      }

      const upload = new tus.Upload(file, {
        endpoint: storageBaseUrl(),
        retryDelays: [0, 1000, 3000, 6000, 12000],
        headers: { authorization: `Bearer ${token}` },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: CHUNK_SIZE,
        metadata: {
          bucketName: EVIDENCE_BUCKET,
          objectName: path,
          contentType,
          cacheControl: "3600",
        },
        onError(err) {
          console.error("[civicx] resumable video upload failed", err);
          reject(new Error(mapStorageError(err?.message ?? "")));
        },
        onProgress(sent, total) {
          if (total > 0) onProgress?.(Math.min(99, Math.round((sent / total) * 100)));
        },
        onSuccess() {
          onProgress?.(100);
          resolve();
        },
      });

      // Resume a previous attempt for the same file where one exists.
      const previous = await upload.findPreviousUploads().catch(() => []);
      if (previous.length > 0 && previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    })().catch((err) => reject(err instanceof Error ? err : new Error("UPLOAD_FAILED")));
  });
}

/** Turns an internal error code into wording the citizen can act on. */
export function videoErrorMessage(code: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "You are not allowed to upload this video. Please sign in again.";
    case "STORAGE_LIMIT":
      return "This video is larger than the storage limit for this project. Please upload a shorter video.";
    case "RECORD_FAILED":
      return "The video uploaded but we could not save its record. Please try again.";
    case "STORAGE_UNAVAILABLE":
      return "Video storage is unavailable right now. Please try again later.";
    default:
      return "The video upload failed. Check your connection and retry.";
  }
}
