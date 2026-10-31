import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listTasks, saveTask, setTaskStatus } from "@/lib/tasks.functions";
import { intlLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function dueAt(daysAhead: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

/** Next-step tasks inside the lead card (amoCRM golden rule). */
export function LeadTasks({ leadId, customerId, memberId }: { leadId: string; customerId: string | null; memberId: string | null }) {
  const qc = useQueryClient();
  const fetchTasks = useServerFn(listTasks);
  const save = useServerFn(saveTask);
  const setStatus = useServerFn(setTaskStatus);
  const [title, setTitle] = useState("");
  const [days, setDays] = useState(0);

  const tasks = useQuery({ queryKey: ["tasks", "lead", leadId], queryFn: () => fetchTasks({ data: { leadId } }) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const create = useMutation({
    mutationFn: () =>
      save({
        data: {
          title: title.trim(),
          lead_id: leadId,
          customer_id: customerId,
          assigned_member_id: memberId,
          due_date: dueAt(days),
          priority: "medium",
          status: "pending",
        },
      }),
    onSuccess: () => {
      setTitle("");
      toast.success(t("Vazifa qo‘shildi"));
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t("Vazifani saqlab bo‘lmadi")),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => setStatus({ data: { id: v.id, status: v.done ? "completed" : "pending" } }),
    onSuccess: refresh,
  });

  const now = Date.now();
  const rows = tasks.data ?? [];
  const open = rows.filter((r) => r.status !== "completed");
  const presets = [
    { d: 0, label: "Bugun" },
    { d: 1, label: "Ertaga" },
    { d: 3, label: "3 kun" },
    { d: 7, label: "Hafta" },
  ];

  return (
    <div className="clay-panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{t("Keyingi qadam")}</p>
        <div className="flex items-center gap-2">
          {open.length === 0 && !tasks.isPending ? (
            <span className="rounded border border-destructive/40 px-2 py-0.5 text-xs text-destructive">{t("Vazifa yo‘q")}</span>
          ) : null}
          <Link
            to="/dashboard/tasks"
            search={{ leadId }}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("Vazifalar")}
          </Link>
        </div>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <Label htmlFor="lead-task-title" className="sr-only">{t("Vazifa")}</Label>
        <Input id="lead-task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Masalan: qo‘ng‘iroq qilish, narx yuborish…")} />
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <Button key={p.d} type="button" size="sm" variant={days === p.d ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setDays(p.d)}>
              {t(p.label)}
            </Button>
          ))}
          <Button type="submit" size="sm" className="ml-auto h-7" disabled={!title.trim() || create.isPending}>
            <Plus className="mr-1 size-3.5" /> {t("Qo‘shish")}
          </Button>
        </div>
      </form>
      <ul className="space-y-1.5">
        {rows.map((task) => {
          const done = task.status === "completed";
          const overdue = !done && task.due_date && new Date(task.due_date).getTime() < now;
          return (
            <li key={task.id} className="clay-inset flex items-start gap-2 rounded-xl p-2 text-sm">
              <button type="button" aria-label={done ? t("Qayta ochish") : t("Bajarildi")} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: task.id, done: !done })}>
                {done ? <CheckCircle2 className="size-4 text-muted-foreground" /> : <Circle className="size-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("break-words", done && "text-muted-foreground line-through")}>{task.title}</p>
                {task.due_date ? (
                  <p className={cn("text-xs text-muted-foreground", overdue && "font-medium text-destructive")}>
                    {overdue ? `${t("Muddati o‘tgan")} · ` : ""}
                    {new Date(task.due_date).toLocaleString(intlLocale())}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
