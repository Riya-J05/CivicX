import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage, type Language } from "@/lib/i18n";

const OPTIONS: Array<{ id: Language; short: string; label: string }> = [
  { id: "en", short: "EN", label: "English" },
  { id: "hi", short: "हिं", label: "हिंदी" },
];

/**
 * English / हिंदी switch. The choice is stored on the device and applies to
 * the whole platform, including AI replies.
 */
export function LanguageToggle({
  className,
  showIcon = true,
}: {
  className?: string;
  showIcon?: boolean;
}) {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      data-no-translate
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-border/70 bg-secondary/40 p-0.5",
        className,
      )}
    >
      {showIcon && <Languages className="ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setLanguage(option.id)}
          aria-pressed={language === option.id}
          aria-label={option.label}
          title={option.label}
          className={cn(
            "rounded-lg px-2 py-1 font-mono text-[10px] leading-none tracking-[0.14em] transition-colors",
            language === option.id
              ? "bg-cyan/15 text-cyan"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
