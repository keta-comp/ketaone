import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "info" | "danger";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    info: "text-info",
    danger: "text-destructive",
  }[tone];
  return (
    <div className="clay-panel clay-hover p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span className="clay-inset grid size-9 place-items-center text-primary">{icon}</span>
        ) : null}
      </div>
      <p className={cn("mt-2 font-display text-2xl font-semibold tabular-nums sm:text-3xl", toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function LoadingState({ label = "Yuklanmoqda…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = friendlyError(error, "Nimadir xato ketdi");
  return (
    <div className="clay-panel flex flex-col items-center gap-3 p-10 text-center">
      <span className="clay-inset grid size-14 place-items-center"><AlertTriangle className="size-6 text-destructive" /></span>
      <div>
        <p className="font-medium text-foreground">{t("Ma’lumotlarni yuklab bo‘lmadi")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("Qayta urinish")}
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="clay-panel flex flex-col items-center gap-3 p-12 text-center">
      <span className="clay-inset grid size-14 place-items-center"><Inbox className="size-6 text-muted-foreground" /></span>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const key = (value ?? "unknown").toLowerCase();
  const tone =
    {
      hot: "bg-destructive/15 text-destructive border-destructive/30",
      warm: "bg-warning/15 text-warning border-warning/30",
      cold: "bg-info/15 text-info border-info/30",
      new: "bg-info/15 text-info border-info/30",
      needs_attention: "bg-destructive/15 text-destructive border-destructive/30",
      assigned: "bg-warning/15 text-warning border-warning/30",
      contacted: "bg-warning/15 text-warning border-warning/30",
      negotiating: "bg-warning/15 text-warning border-warning/30",
      won: "bg-success/15 text-success border-success/30",
      lost: "bg-muted text-muted-foreground border-border",
      confirming: "bg-warning/15 text-warning border-warning/30",
      confirmed: "bg-success/15 text-success border-success/30",
      preparing: "bg-info/15 text-info border-info/30",
      delivered: "bg-success/15 text-success border-success/30",
      cancelled: "bg-muted text-muted-foreground border-border",
      paid: "bg-success/15 text-success border-success/30",
      unpaid: "bg-muted text-muted-foreground border-border",
      partial: "bg-warning/15 text-warning border-warning/30",
      refunded: "bg-muted text-muted-foreground border-border",
      in_stock: "bg-success/15 text-success border-success/30",
      low_stock: "bg-warning/15 text-warning border-warning/30",
      out_of_stock: "bg-destructive/15 text-destructive border-destructive/30",
      ai: "bg-primary/15 text-primary border-primary/30",
      human: "bg-warning/15 text-warning border-warning/30",
    }[key] ?? "bg-muted text-muted-foreground border-border";

  const label =
    (
      {
        hot: "Qaynoq",
        warm: "Iliq",
        cold: "Sovuq",
        new: "Yangi",
        needs_attention: "E'tibor kerak",
        assigned: "Tayinlangan",
        contacted: "Bog'lanildi",
        negotiating: "Muzokara",
        won: "Yopildi",
        lost: "Yo'qotildi",
        confirming: "Tasdiqlanmoqda",
        confirmed: "Tasdiqlangan",
        preparing: "Tayyorlanmoqda",
        delivered: "Yetkazildi",
        cancelled: "Bekor qilindi",
        paid: "To'langan",
        unpaid: "To'lanmagan",
        partial: "Qismiy to'lov",
        refunded: "Qaytarilgan",
        in_stock: "Omborda",
        low_stock: "Kam qoldi",
        out_of_stock: "Tugagan",
        ai: "AI",
        human: "Inson",
        unknown: "Noma'lum",
      } as Record<string, string>
    )[key] ?? key.replace(/_/g, " ");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-clay-sm",
        tone,
      )}
    >
      {label}
    </span>
  );
}