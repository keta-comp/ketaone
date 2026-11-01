import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/app/primitives";
import { TaskDialog } from "@/components/app/crm-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { crmLabel, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/crm-core";
import { deleteTask, listTasks, setTaskStatus } from "@/lib/tasks.functions";
import { useSectionVisibility } from "@/lib/section-visibility";
import { t } from "@/lib/i18n";

const searchSchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  customerId: z.string().optional(),
  memberId: z.string().optional(),
  search: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/dashboard/tasks")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: t("Vazifalar — KetaOne") },
      { name: "description", content: t("Jamoa vazifalari, muddatlari va bajarilish holati.") },
      { property: "og:title", content: t("Vazifalar — KetaOne") },
      { property: "og:description", content: t("Hech bir ish e’tibordan chetda qolmasin.") },
    ],
  }),
  component: TasksPage,
});

type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];

function TasksPage() {
  const params = Route.useSearch();
  const navigate = useNavigate();
  const fetchTasks = useServerFn(listTasks);
  const changeStatus = useServerFn(setTaskStatus);
  const remove = useServerFn(deleteTask);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [open, setOpen] = useState(false);

  const status = params.status ?? "all";
  const priority = params.priority ?? "all";
  const search = params.search ?? "";
  const customerId = params.customerId ?? null;
  const memberId = params.memberId ?? null;

  const setFilter = (next: "status" | "priority" | "search", value: string) =>
    void navigate({
      to: "/dashboard/tasks",
      search: (prev) => ({
        ...prev,
        [next]: value === "all" || value === "" ? undefined : value,
      }),
    });

  const { isHidden } = useSectionVisibility();
  const showOrders = !isHidden("/dashboard/orders");

  const query = useQuery({
    queryKey: ["tasks", status, priority, search, customerId, memberId],
    queryFn: () =>
      fetchTasks({
        data: {
          status,
          priority,
          search,
          ...(customerId ? { customerId } : {}),
          ...(memberId ? { memberId } : {}),
        },
      }),
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <>
      <PageHeader
        title={t("Vazifalar")}
        description={t("Qo‘ng‘iroq qilish, uchrashuv, kuzatuv — hammasi bir joyda.")}
        actions={
          <Button
            size="sm"
            className="gap-1"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> {t("Yangi vazifa")}
          </Button>
        }
      />

      <div className="clay-panel flex flex-wrap items-center gap-2 p-4">
        <Input
          value={search}
          onChange={(e) => setFilter("search", e.target.value)}
          placeholder={t("Vazifa nomi…")}
          className="h-9 w-full sm:w-64"
        />
        <Select value={status} onValueChange={(value) => setFilter("status", value)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder={t("Holat")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Barcha holat")}</SelectItem>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {crmLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={(value) => setFilter("priority", value)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder={t("Muhimlik")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Barcha muhimlik")}</SelectItem>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {crmLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {customerId || memberId ? (
          <button
            type="button"
            onClick={() =>
              void navigate({
                to: "/dashboard/tasks",
                search: (prev) => ({
                  ...prev,
                  customerId: undefined,
                  memberId: undefined,
                }),
              })
            }
            className="clay-inset h-9 rounded-xl px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {t("Filtrlarni tozalash")} ✕
          </button>
        ) : null}
      </div>

      {query.isPending ? (
        <LoadingState label={t("Vazifalar yuklanmoqda…")} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState title={t("Vazifa yo‘q")} description={t("Yangi vazifa qo‘shib, ishni rejalashtiring.")} />
      ) : (
        <div className="space-y-2">
          {(query.data ?? []).map((task) => {
            const customer = task.customers as { id: string | null; full_name: string | null } | null;
            const order = task.orders as { id: string | null; order_number: string | null } | null;
            const assignee = task.assignee_name;
            const overdue =
              task.due_date && task.status !== "completed" && new Date(task.due_date) < today;
            return (
              <div
                key={task.id}
                className="clay-panel flex flex-wrap items-center gap-3 p-4"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Bajarildi")}
                  className={task.status === "completed" ? "text-foreground" : "text-muted-foreground"}
                  onClick={async () => {
                    try {
                      await changeStatus({
                        data: {
                          id: task.id,
                          status: task.status === "completed" ? "pending" : "completed",
                        },
                      });
                      void query.refetch();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : t("Xatolik"));
                    }
                  }}
                >
                  <CheckCircle2 className="size-5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${
                      task.status === "completed" ? "line-through opacity-60" : ""
                    }`}
                  >
                    {task.title}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {customer?.full_name ? (
                      customer.id ? (
                        <Link
                          to="/dashboard/customers/$id"
                          params={{ id: customer.id }}
                          className="underline-offset-4 hover:underline"
                        >
                          {customer.full_name}
                        </Link>
                      ) : (
                        <span>{customer.full_name}</span>
                      )
                    ) : null}
                    {assignee ? (
                      <Link to="/dashboard/team" className="underline-offset-4 hover:underline">
                        {t("Mas’ul:")} {assignee}
                      </Link>
                    ) : null}
                    {task.due_date ? (
                      <span>{t("Muddat: {v0}", { v0: new Date(task.due_date).toLocaleDateString("uz-UZ") })}</span>
                    ) : null}
                    {overdue ? <span className="text-destructive">{t("Muddati o‘tgan")}</span> : null}
                    {showOrders && order?.order_number ? (
                      <Link
                        to="/dashboard/orders"
                        search={{ search: order.order_number }}
                        className="underline-offset-4 hover:underline"
                      >
                        #{order.order_number}
                      </Link>
                    ) : null}
                    {!customer?.full_name && !assignee && !task.due_date && !(showOrders && order?.order_number) ? (
                      <span>{t("Qo‘shimcha ma’lumot yo‘q")}</span>
                    ) : null}
                  </p>
                </div>
                <StatusBadge value={task.priority} />
                <StatusBadge value={task.status} />
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("Tahrirlash")}
                    onClick={() => {
                      setEditing(task);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("O‘chirish")}
                    onClick={async () => {
                      if (!window.confirm(t("Vazifani o‘chirasizmi?"))) return;
                      try {
                        await remove({ data: { id: task.id } });
                        toast.success(t("Vazifa o‘chirildi"));
                        void query.refetch();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : t("Xatolik"));
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskDialog
        open={open}
        onOpenChange={setOpen}
        defaultCustomerId={customerId ?? undefined}
        task={
          editing
            ? {
                id: editing.id,
                title: editing.title,
                description: editing.description,
                assigned_member_id: editing.assigned_member_id,
                customer_id: editing.customer_id,
                order_id: editing.order_id,
                due_date: editing.due_date,
                priority: editing.priority as "low" | "medium" | "high",
                status: editing.status as "pending" | "in_progress" | "completed",
              }
            : undefined
        }
        label={editing ? t("Vazifani tahrirlash") : t("Yangi vazifa")}
      />
    </>
  );
}
