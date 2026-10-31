import { useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { intlLocale, t } from "@/lib/i18n";
import { groupLeads, leadStatusChange, LEAD_STATUS_LABELS, type LeadTaskState } from "@/lib/lead-kanban";
import { LEAD_STATUSES, type LeadScore, type LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type KanbanLead = {
  id: string;
  status: LeadStatus;
  score: LeadScore;
  requested_product: string | null;
  ai_summary: string | null;
  created_at: string;
  customers: { full_name: string | null; telegram_username: string | null; phone: string | null } | null;
  assignee_name: string | null;
};

type Props = {
  rows: KanbanLead[];
  taskStates?: Record<string, LeadTaskState>;
  pending: boolean;
  movingId?: string;
  onOpen: (id: string) => void;
  onMove: (id: string, status: LeadStatus) => void;
};

const scoreLabels = { hot: "Issiq", warm: "Iliq", cold: "Sovuq" };
const taskBadge: Partial<Record<LeadTaskState, { label: string; cls: string }>> = {
  overdue: { label: "Muddati o‘tgan", cls: "border-destructive/50 text-destructive" },
  today: { label: "Bugungi vazifa", cls: "border-foreground/40 text-foreground" },
  none: { label: "Vazifa yo‘q", cls: "border-dashed border-muted-foreground/60 text-muted-foreground" },
};

function LeadCard({ row, pending, movingId, onOpen, onMove, taskStates }: Omit<Props, "rows"> & { row: KanbanLead }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id, disabled: pending });
  return (
    <article ref={setNodeRef} aria-busy={movingId === row.id} className={cn("clay-raised min-w-0 rounded-lg border border-border bg-card p-3", isDragging && "opacity-40")}>
      <div className="flex items-start justify-between gap-2">
        <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start whitespace-normal p-0 text-left" onClick={() => onOpen(row.id)}>
          <span className="break-words">{row.customers?.full_name ?? t("Telegram mijozi")}</span>
        </Button>
        <Tooltip><TooltipTrigger asChild>
          <Button ref={undefined} variant="ghost" size="icon" className="size-7 shrink-0 touch-none cursor-grab active:cursor-grabbing" disabled={pending} {...attributes} {...listeners} aria-label={t("Lidni ko‘chirish")}>
            {movingId === row.id ? <Loader2 className="size-4 animate-spin" /> : <GripVertical className="size-4" />}
          </Button>
        </TooltipTrigger><TooltipContent>{t("Lidni ko‘chirish")}</TooltipContent></Tooltip>
      </div>
      <p className="mt-1 break-words text-xs text-muted-foreground">{row.customers?.telegram_username ? `@${row.customers.telegram_username}` : row.customers?.phone ?? "—"}</p>
      <p className="mt-3 break-words text-sm font-medium">{row.requested_product ?? "—"}</p>
      {row.ai_summary && <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{row.ai_summary}</p>}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="rounded border border-border bg-muted px-2 py-0.5">{t(scoreLabels[row.score])}</span>
        <span>{new Date(row.created_at).toLocaleDateString(intlLocale())}</span>
      </div>
      {(() => { const st = taskStates?.[row.id]; const b = st ? taskBadge[st] : undefined; return b ? <p className={cn("mt-2 inline-block rounded border px-2 py-0.5 text-xs font-medium", b.cls)}>{t(b.label)}</p> : null; })()}
      <p className="mt-2 truncate text-xs text-muted-foreground" title={row.assignee_name ?? undefined}>{row.assignee_name ?? t("Biriktirilmagan")}</p>
      <Select value={row.status} disabled={pending} onValueChange={(value) => { const next = leadStatusChange(row.status, value); if (next) onMove(row.id, next); }}>
        <SelectTrigger className="mt-3 h-8 w-full text-xs" aria-label={t("Lid bosqichi")}><SelectValue /></SelectTrigger>
        <SelectContent>{LEAD_STATUSES.map((status) => <SelectItem key={status} value={status}>{t(LEAD_STATUS_LABELS[status])}</SelectItem>)}</SelectContent>
      </Select>
    </article>
  );
}

function Column({ status, children, count }: { status: LeadStatus; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section aria-label={t(LEAD_STATUS_LABELS[status])} className="flex w-72 shrink-0 flex-col gap-3">
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-2 pb-2">
        <h2 className="text-sm font-semibold">{t(LEAD_STATUS_LABELS[status])}</h2>
        <span className="rounded bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">{count}</span>
      </div>
      <div ref={setNodeRef} className={cn("flex min-h-64 flex-1 flex-col gap-3 rounded-lg bg-muted/40 p-2 transition-colors motion-reduce:transition-none", isOver && "bg-accent ring-2 ring-ring")}>
        {children}
        {count === 0 && <p className="py-10 text-center text-xs text-muted-foreground">{t("Bu bosqichda lidlar yo‘q")}</p>}
      </div>
    </section>
  );
}

export function LeadKanban(props: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const active = props.rows.find((row) => row.id === activeId);
  const end = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || props.pending) return;
    const row = props.rows.find((row) => row.id === active.id);
    if (!row) return;
    const next = leadStatusChange(row.status, String(over.id));
    if (next) props.onMove(row.id, next);
  };
  return (
    <TooltipProvider>
      <DndContext sensors={sensors} onDragStart={({ active }) => setActiveId(String(active.id))} onDragEnd={end} onDragCancel={() => setActiveId(null)} accessibility={{
        screenReaderInstructions: { draggable: t("Ko‘chirish uchun bo‘sh joy tugmasini bosing, yo‘nalish tugmalari bilan siljiting, tasdiqlash uchun yana bosing.") },
        announcements: {
          onDragStart: () => t("Lid tanlandi"),
          onDragOver: ({ over }) => over ? t(LEAD_STATUS_LABELS[over.id as LeadStatus] ?? "Lidni ko‘chirish") : t("Lidni ko‘chirish"),
          onDragEnd: () => t("Ko‘chirish yakunlandi"),
          onDragCancel: () => t("Ko‘chirish bekor qilindi"),
        },
      }}>
        <div className="flex items-stretch gap-4 overflow-x-auto pb-4" role="region" aria-label={t("Lidlar Kanban doskasi")} tabIndex={0}>
          {groupLeads(props.rows).map(({ status, rows }) => <Column key={status} status={status} count={rows.length}>{rows.map((row) => <LeadCard key={row.id} row={row} {...props} />)}</Column>)}
        </div>
        <DragOverlay dropAnimation={null}>{active ? <div className="w-72 rounded-lg border border-border bg-card p-4 shadow-clay-sm"><p className="break-words font-medium">{active.customers?.full_name ?? t("Telegram mijozi")}</p><p className="mt-2 break-words text-sm text-muted-foreground">{active.requested_product ?? "—"}</p></div> : null}</DragOverlay>
      </DndContext>
    </TooltipProvider>
  );
}