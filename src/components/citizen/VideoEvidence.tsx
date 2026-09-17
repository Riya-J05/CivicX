/**
 * Video evidence控件 for the citizen report form.
 *
 * Handles picking a video from the device and recording one with the camera
 * through MediaRecorder. The chosen clip stays a local object URL until the
 * report is transmitted; the upload itself is driven by the parent so progress
 * can be shown next to the rest of the submission.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleStop, Film, RotateCcw, Trash2, Video } from "lucide-react";
import {
  MAX_VIDEO_BYTES,
  VIDEO_ACCEPT_ATTR,
  formatBytes,
  formatDuration,
  probeVideoDuration,
  validateVideoFile,
} from "@/lib/video-evidence";
import { cn } from "@/lib/utils";

export interface SelectedVideo {
  file: File;
  name: string;
  size: number;
  previewUrl: string;
  durationSeconds: number | null;
}

export type VideoUploadStatus = "idle" | "uploading" | "done" | "failed";

interface Props {
  value: SelectedVideo | null;
  onChange: (video: SelectedVideo | null) => void;
  status?: VideoUploadStatus;
  progress?: number;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export function VideoEvidence({
  value,
  onChange,
  status = "idle",
  progress = 0,
  errorMessage = null,
  onRetry,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const liveVideo = useRef<HTMLVideoElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const supportsRecording =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined";

  const stopStream = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const acceptFile = async (file: File) => {
    const problem = validateVideoFile(file);
    if (problem === "type") {
      setLocalError("That file is not a supported video type. Use MP4, WebM or MOV.");
      return;
    }
    if (problem === "size") {
      setLocalError(
        `This video is too large. The maximum size is ${formatBytes(MAX_VIDEO_BYTES)}.`,
      );
      return;
    }
    setLocalError(null);
    if (value) URL.revokeObjectURL(value.previewUrl);
    const durationSeconds = await probeVideoDuration(file);
    onChange({
      file,
      name: file.name,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
      durationSeconds,
    });
  };

  const remove = () => {
    if (value) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
    setLocalError(null);
  };

  const openCamera = async () => {
    if (!supportsRecording) {
      setLocalError("Video recording is not supported in this browser. Please upload a video instead.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });
      stream.current = media;
      setCameraOpen(true);
      setLocalError(null);
      window.setTimeout(() => {
        if (liveVideo.current) {
          liveVideo.current.srcObject = media;
          void liveVideo.current.play().catch(() => undefined);
        }
      }, 0);
    } catch {
      setLocalError(
        "Camera permission was denied. Allow camera access, or upload a video from your device instead.",
      );
    }
  };

  const closeCamera = () => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    recorder.current = null;
    stopStream();
    setRecording(false);
    setElapsed(0);
    setCameraOpen(false);
  };

  const startRecording = () => {
    if (!stream.current) return;
    chunks.current = [];
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"].find((m) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
    );
    try {
      const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || "video/webm";
        const blob = new Blob(chunks.current, { type });
        chunks.current = [];
        if (blob.size === 0) return;
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `civicx-recording-${Date.now()}.${ext}`, { type });
        void acceptFile(file).then(closeCamera);
      };
      rec.start(1000);
      recorder.current = rec;
      setRecording(true);
      setElapsed(0);
      timer.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setLocalError("Recording could not start in this browser. Please upload a video instead.");
    }
  };

  const stopRecording = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };

  const message = errorMessage ?? localError;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-2 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-cyan"
        >
          <Video className="h-3.5 w-3.5" /> UPLOAD VIDEO
        </button>
        <button
          type="button"
          onClick={() => void openCamera()}
          className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-foreground/80 transition-colors hover:border-cyan/30"
        >
          <Camera className="h-3.5 w-3.5" /> RECORD VIDEO
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={VIDEO_ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void acceptFile(file);
          }}
        />
      </div>

      {!supportsRecording && (
        <p className="text-xs text-muted-foreground">
          Camera recording is not supported in this browser — you can still upload a video.
        </p>
      )}

      {cameraOpen && (
        <div className="glass-soft space-y-3 rounded-2xl p-3">
          <video
            ref={liveVideo}
            muted
            playsInline
            className="w-full rounded-xl bg-black/60"
            style={{ maxHeight: 280 }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {!recording ? (
              <button
                type="button"
                onClick={startRecording}
                className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-destructive"
              >
                <span className="h-2 w-2 rounded-full bg-destructive" /> START RECORDING
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="flex items-center gap-2 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-cyan"
              >
                <CircleStop className="h-3.5 w-3.5" /> STOP RECORDING
              </button>
            )}
            {recording && (
              <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                {formatDuration(elapsed) ?? "0:00"}
              </span>
            )}
            <button
              type="button"
              onClick={closeCamera}
              className="ml-auto font-mono text-[10px] tracking-[0.16em] text-muted-foreground hover:text-foreground"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {value && (
        <div className="glass-soft space-y-3 rounded-2xl p-3">
          <video
            src={value.previewUrl}
            controls
            preload="metadata"
            className="w-full rounded-xl bg-black/60"
            style={{ maxHeight: 280 }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Film className="h-4 w-4 shrink-0 text-cyan" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{value.name}</span>
              <span className="block font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
                VIDEO • {formatBytes(value.size)}
                {formatDuration(value.durationSeconds)
                  ? ` • ${formatDuration(value.durationSeconds)}`
                  : ""}
              </span>
            </span>
            {supportsRecording && (
              <button
                type="button"
                onClick={() => void openCamera()}
                className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground hover:text-cyan"
              >
                <RotateCcw className="h-3.5 w-3.5" /> RETAKE
              </button>
            )}
            <button
              type="button"
              aria-label="Remove video"
              onClick={remove}
              className="text-muted-foreground transition-colors hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {status === "uploading" && (
            <div className="space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-cyan transition-all"
                  style={{ width: `${Math.max(3, progress)}%` }}
                />
              </div>
              <p className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                UPLOADING {progress}%
              </p>
            </div>
          )}
          {status === "done" && (
            <p className="font-mono text-[10px] tracking-[0.16em] text-cyan">UPLOAD COMPLETE</p>
          )}
          {status === "failed" && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[10px] tracking-[0.16em] text-destructive">
                UPLOAD FAILED
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className={cn(
                    "rounded-xl border border-cyan/30 bg-cyan/10 px-3 py-1.5",
                    "font-mono text-[10px] tracking-[0.16em] text-cyan",
                  )}
                >
                  RETRY
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
