import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Radar, Settings, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { roleById } from "@/lib/civicx-roles";
import { LanguageToggle } from "@/components/civicx/LanguageToggle";

function initialsFor(name: string | null | undefined, email: string | null | undefined) {
  const source = (name ?? email ?? "").trim();
  if (!source) return "CX";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "C";
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "X";
  return (first + second).toUpperCase();
}

/**
 * Signed-in operator badge with the console menu (Profile, My Missions,
 * Settings, Sign Out). Sign-out clears cached data before leaving.
 */
export function UserMenu({
  onNavigateSection,
}: {
  onNavigateSection?: ((id: string) => void) | undefined;
}) {
  const reduced = useReducedMotion();
  const { currentProfile, currentUser, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = currentProfile?.name ?? currentUser?.email ?? "Operator";
  const role = currentProfile?.role ?? "citizen";
  const roleLabel = role === "citizen" ? "Community Member" : roleById[role].title;

  const handleSignOut = async () => {
    setOpen(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOut();
    void navigate({ to: "/login", replace: true });
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left transition-colors hover:border-cyan/40"
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-[11px] tracking-widest text-cyan"
          style={{
            backgroundColor: "color-mix(in oklab, var(--neon-cyan) 12%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--neon-cyan) 30%, transparent)",
          }}
        >
          {initialsFor(currentProfile?.name, currentProfile?.email ?? currentUser?.email)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={reduced ? false : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="glass absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-full overflow-hidden rounded-xl p-1.5"
          >
            <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5">
              <span className="text-sm text-muted-foreground">Language</span>
              <LanguageToggle showIcon={false} />
            </div>
            <Link
              to="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-cyan/10 hover:text-foreground"
            >
              <User className="h-4 w-4" />
              Profile
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNavigateSection?.("missions");
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-cyan/10 hover:text-foreground"
            >
              <Radar className="h-4 w-4" />
              My Missions
            </button>
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-cyan/10 hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
