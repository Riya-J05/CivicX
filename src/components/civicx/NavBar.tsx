import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Menu, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { BrandLogo } from "./BrandLogo";
import { LanguageToggle } from "./LanguageToggle";

const links = [
  { label: "Explore Challenges", href: "#live-world" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Impact", href: "#impact" },
  { label: "For Universities", href: "#forces" },
  { label: "For Industry", href: "#missions" },
];

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>("#top");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // highlight the nav item for the section currently in view
  useEffect(() => {
    const ids = ["top", "live-world", "impact", "how-it-works", "forces", "missions"];
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveId(`#${visible.target.id}`);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.6, 1] },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <motion.nav
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl px-4 transition-all duration-500 lg:px-6",
          scrolled || open
            ? "glass py-2 shadow-[0_10px_40px_-18px_color-mix(in_oklab,var(--neon-cyan)_35%,transparent)]"
            : "border border-transparent bg-transparent py-4 backdrop-blur-[2px]",
          open && "bg-background/95",
        )}
      >
        <a href="#top" aria-label="CivicX home" className="flex min-w-0 items-center">
          <BrandLogo
            eager
            className={cn(
              "w-auto object-left transition-all duration-500",
              scrolled ? "h-9 sm:h-10" : "h-10 sm:h-12",
            )}
          />
        </a>

        <div className="hidden items-center gap-1 lg:flex">
          {links.map((l) => {
            const isActive = activeId === l.href;
            return (
              <a
                key={l.label}
                href={l.href}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    transition={{ type: "spring", stiffness: 340, damping: 30 }}
                    className="absolute inset-x-2 -bottom-0.5 h-px"
                    style={{
                      backgroundImage: "var(--gradient-accent)",
                      boxShadow: "0 0 10px var(--neon-cyan)",
                    }}
                  />
                )}
              </a>
            );
          })}
          <LanguageToggle className="ml-2" />
          <Link
            to="/access"
            className="ml-2 rounded-xl border border-cyan/35 bg-cyan/10 px-4 py-2 text-sm font-medium text-cyan transition-all duration-300 hover:bg-cyan/20 hover:shadow-[var(--shadow-glow-cyan)] active:scale-[0.97]"
          >
            Enter Platform
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-foreground lg:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="col-span-2 overflow-hidden lg:hidden"
            >
              <div className="mt-2 flex flex-col gap-1 border-t border-border pt-3">
                {links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  >
                    {l.label}
                  </a>
                ))}
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="text-sm text-muted-foreground">Language</span>
                  <LanguageToggle showIcon={false} />
                </div>
                <Link
                  to="/access"
                  onClick={() => setOpen(false)}
                  className="mt-1 rounded-xl border border-cyan/35 bg-cyan/10 px-3 py-2.5 text-center text-sm font-medium text-cyan"
                >
                  Enter Platform
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
    </header>
  );
}
