import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  PropsWithChildren,
} from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Button({
  className,
  children,
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      className={cx(
        "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-blue-500/35 disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight text-slate-950">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-[10px] bg-blue-600 text-sm text-white"
      >
        D
      </span>
      {!compact && <span>DirectDrop</span>}
    </span>
  );
}

export function StatusPill({
  tone = "neutral",
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLSpanElement>> & {
  tone?: "success" | "warning" | "danger" | "neutral";
}) {
  const tones = {
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
    danger: "bg-red-50 text-red-800 ring-red-200",
    neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  };
  return (
    <span
      className={cx(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  label = "전송 진행률",
}: {
  value: number;
  label?: string;
}) {
  const safe = Math.min(100, Math.max(0, value));
  return (
    <div
      className="h-2.5 overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safe)}
    >
      <div
        className="h-full rounded-full bg-blue-600 transition-transform duration-200 motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - safe}%)` }}
      />
    </div>
  );
}
