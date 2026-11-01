import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveCrmCustomer } from "@/lib/customers.functions";
import { listStudentGroups, listStudyGroups, syncStudentGroups } from "@/lib/groups.functions";
import { savePayment } from "@/lib/payments.functions";
import { saveTask } from "@/lib/tasks.functions";
import { createQuickOrder, listPickers } from "@/lib/quick.functions";
import { useSectionVisibility } from "@/lib/section-visibility";
import { useTerminology } from "@/lib/terminology";
import {
  CUSTOMER_SOURCES,
  CUSTOMER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_RECORD_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  QUICK_ACTION_SECTIONS,
  crmLabel,
  quickActionLabels,
  type QuickActionKey,
} from "@/lib/crm-core";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";

const NONE = "__none__";

export function usePickers(enabled = true) {
  const fetchPickers = useServerFn(listPickers);
  return useQuery({
    queryKey: ["pickers"],
    queryFn: () => fetchPickers(),
    enabled,
    staleTime: 30_000,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [
      "customers",
      "customer",
      // Qabul formasidagi tez qo'shish ro'yxatidan keyin navbat selektori ham yangilansin.
      "customers-booking",
      "orders",
      "payments",
      "tasks",
      "kpis",
      "report",
      "pickers",
      "activities",
      "study-groups",
      "study-group-members",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

type CustomerSeed = {
  id?: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  location?: string | null;
  status?: string | null;
  source?: string | null;
  assigned_member_id?: string | null;
  notes?: string | null;
};

export function CustomerDialog({
  open,
  onOpenChange,
  customer,
  title,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  customer?: CustomerSeed | undefined;
  title?: string;
  /** Tez qo'shish oqimi: saqlangan mijozni darhol tanlash uchun (masalan qabulda). */
  onSaved?: (saved: { id: string }) => void;
}) {
  const save = useServerFn(saveCrmCustomer);
  const fetchGroups = useServerFn(listStudyGroups);
  const fetchLinkedGroups = useServerFn(listStudentGroups);
  const linkGroups = useServerFn(syncStudentGroups);
  const invalidate = useInvalidate();
  const pickers = usePickers(open);
  const { term } = useTerminology();
  const person = term("customers").one;
  const { isHidden } = useSectionVisibility();
  const [form, setForm] = useState<CustomerSeed>({});
  /** null — hali tanlanmagan: saqlashda guruhlar ro'yxatiga tegmaymiz. */
  const [groupIds, setGroupIds] = useState<string[] | null>(null);

  const showGroups = !isHidden("/dashboard/groups");
  const studentId = form.id;

  useEffect(() => {
    if (open) {
      setForm(customer ?? { status: "active", source: "manual" });
      setGroupIds(null);
    }
  }, [open, customer]);

  const groups = useQuery({
    queryKey: ["study-groups"],
    queryFn: () => fetchGroups({ data: {} }),
    enabled: open && showGroups,
  });
  const linked = useQuery({
    queryKey: ["student-groups", studentId],
    queryFn: () => fetchLinkedGroups({ data: { studentId: studentId ?? "" } }),
    enabled: open && showGroups && Boolean(studentId),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const saved = await save({
        data: {
          ...(form.id ? { id: form.id } : {}),
          full_name: (form.full_name ?? "").trim(),
          phone: form.phone ?? null,
          email: form.email ?? null,
          location: form.location ?? null,
          status: form.status ?? "active",
          source: form.source ?? "manual",
          assigned_member_id: form.assigned_member_id ?? null,
          notes: form.notes ?? null,
        },
      });
      const next = groupIds ?? linked.data?.groupIds ?? [];
      // Yangi o‘quvchi tanlovsiz saqlansa bo‘sh sinxronizatsiya kerak emas.
      if (groupIds !== null || next.length > 0) {
        await linkGroups({ data: { studentId: saved.id, groupIds: next } });
      }
      return saved;
    },
    onSuccess: (saved) => {
      toast.success(t("{term} saqlandi", { term: person }));
      invalidate();
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Saqlab bo‘lmadi"))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {form.id
              ? t("{term}ni tahrirlash", { term: person })
              : (title ?? t("Yangi {term}", { term: person }))}
          </DialogTitle>
          <DialogDescription>{t("Faqat kerakli maydonlarni to‘ldiring.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t("Ism *")}>
              <Input
                value={form.full_name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder={t("Ali Valiyev")}
              />
            </Field>
          </div>
          <Field label={t("Telefon")}>
            <Input
              value={form.phone ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+998 90 123 45 67"
            />
          </Field>
          <Field label={t("Email")}>
            <Input
              value={form.email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>
          <Field label={t("Holat")}>
            <Select
              value={form.status ?? "active"}
              onValueChange={(value) => setForm((f) => ({ ...f, status: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {crmLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Manba")}>
            <Select
              value={form.source ?? "manual"}
              onValueChange={(value) => setForm((f) => ({ ...f, source: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {crmLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Manzil")}>
            <Input
              value={form.location ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
          </Field>
          <Field label={t("Mas’ul")}>
            <Select
              value={form.assigned_member_id ?? NONE}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, assigned_member_id: value === NONE ? null : value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Tanlanmagan")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("Tanlanmagan")}</SelectItem>
                {(pickers.data?.assignees ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("Izoh")}>
              <Textarea
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
          </div>
          {showGroups ? (
            <div className="sm:col-span-2">
              <Field label={t("Guruhlar")}>
                <GroupChipsField
                  groups={groups.data ?? []}
                  value={groupIds ?? linked.data?.groupIds ?? []}
                  onChange={setGroupIds}
                  loading={groups.isPending}
                />
              </Field>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Bekor qilish")}
          </Button>
          <Button
            disabled={!form.full_name?.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("Saqlash")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupChipsField({
  groups,
  value,
  onChange,
  loading,
}: {
  groups: {
    id: string;
    name: string;
    course_name: string;
    member_count: number;
    capacity: number;
  }[];
  value: string[];
  onChange: (value: string[]) => void;
  loading: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("Guruhlar yuklanmoqda…")}</p>;
  }
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Hozircha guruhlar yo‘q — Guruhlar bo‘limida oching.")}
      </p>
    );
  }
  const selected = new Set(value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((group) => {
        const on = selected.has(group.id);
        const full = group.capacity > 0 && group.member_count >= group.capacity && !on;
        return (
          <button
            key={group.id}
            type="button"
            disabled={full}
            onClick={() =>
              onChange(on ? value.filter((id) => id !== group.id) : [...value, group.id])
            }
            title={full ? t("Guruh to‘lgan") : group.course_name}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              on
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
              full && "cursor-not-allowed opacity-50",
            )}
          >
            {group.name}
          </button>
        );
      })}
    </div>
  );
}

type OrderLine = {
  product_id: string | null;
  product_name: string;
  quantity: string;
  unit_price: string;
};

export function OrderDialog({
  open,
  onOpenChange,
  defaultCustomerId,
  label = "Yangi buyurtma",
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  defaultCustomerId?: string | undefined;
  label?: string;
}) {
  const create = useServerFn(createQuickOrder);
  const pickers = usePickers(open);
  const invalidate = useInvalidate();
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([
    { product_id: null, product_name: "", quantity: "1", unit_price: "" },
  ]);

  useEffect(() => {
    if (open) {
      setCustomerId(defaultCustomerId ?? "");
      setLines([{ product_id: null, product_name: "", quantity: "1", unit_price: "" }]);
      setDiscount("");
      setNotes("");
    }
  }, [open, defaultCustomerId]);

  const gross = lines.reduce(
    (sum, l) => sum + Number(l.unit_price || 0) * Number(l.quantity || 0),
    0,
  );

  const mutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          customer_id: customerId,
          discount: Number(discount || 0),
          notes: notes || null,
          items: lines
            .filter((l) => l.product_name.trim())
            .map((l) => ({
              product_id: l.product_id,
              product_name: l.product_name.trim(),
              quantity: Number(l.quantity || 1),
              unit_price: Number(l.unit_price || 0),
            })),
        },
      }),
    onSuccess: () => {
      toast.success(t("Buyurtma yaratildi"));
      invalidate();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Saqlab bo‘lmadi"))),
  });

  const setLine = (index: number, patch: Partial<OrderLine>) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {t("Mahsulotni katalogdan tanlang yoki xizmat nomini yozing.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("Mijoz *")}>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder={t("Mijozni tanlang")} />
              </SelectTrigger>
              <SelectContent>
                {(pickers.data?.customers ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name ?? "Ismsiz"} {c.phone ? `· ${c.phone}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_5rem_8rem_2rem]">
                <Input
                  value={line.product_name}
                  placeholder={t("Mahsulot yoki xizmat")}
                  onChange={(e) =>
                    setLine(index, { product_name: e.target.value, product_id: null })
                  }
                  list={`products-${index}`}
                />
                <datalist id={`products-${index}`}>
                  {(pickers.data?.products ?? []).map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
                <Input
                  type="number"
                  value={line.quantity}
                  onChange={(e) => setLine(index, { quantity: e.target.value })}
                />
                <Input
                  type="number"
                  placeholder={t("Narx")}
                  value={line.unit_price}
                  onChange={(e) => setLine(index, { unit_price: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                  aria-label={t("Qatorni o‘chirish")}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setLines((rows) => [
                  ...rows,
                  { product_id: null, product_name: "", quantity: "1", unit_price: "" },
                ])
              }
            >
              <Plus className="mr-1 size-3" /> {t("Qator qo‘shish")}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Chegirma")}>
              <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
            <Field label={t("Izoh")}>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("Jami:")}{" "}
            <span className="font-semibold text-foreground">{gross - Number(discount || 0)}</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Bekor qilish")}
          </Button>
          <Button
            disabled={
              !customerId || !lines.some((l) => l.product_name.trim()) || mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {t("Saqlash")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PaymentSeed = {
  id?: string;
  customer_id?: string | null;
  order_id?: string | null;
  amount?: number | string | null;
  method?: string | null;
  status?: string | null;
  due_date?: string | null;
  note?: string | null;
};

export function PaymentDialog({
  open,
  onOpenChange,
  payment,
  defaultCustomerId,
  label = "Yangi to‘lov",
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  payment?: PaymentSeed | undefined;
  defaultCustomerId?: string | undefined;
  label?: string;
}) {
  const save = useServerFn(savePayment);
  const pickers = usePickers(open);
  const invalidate = useInvalidate();
  const [form, setForm] = useState<PaymentSeed>({});

  useEffect(() => {
    if (open)
      setForm(
        payment ?? {
          customer_id: defaultCustomerId ?? null,
          method: "cash",
          status: "paid",
          amount: "",
        },
      );
  }, [open, payment, defaultCustomerId]);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          ...(form.id ? { id: form.id } : {}),
          customer_id: form.customer_id ?? null,
          order_id: form.order_id ?? null,
          amount: Number(form.amount || 0),
          method: form.method ?? "cash",
          status: (form.status ?? "paid") as "pending" | "paid" | "partial" | "refunded",
          due_date: form.due_date || null,
          note: form.note || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("To‘lov saqlandi"));
      invalidate();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Saqlab bo‘lmadi"))),
  });

  const orders = (pickers.data?.orders ?? []).filter(
    (o) => !form.customer_id || o.customer_id === form.customer_id,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? t("To‘lovni tahrirlash") : label}</DialogTitle>
          <DialogDescription>
            {t("To‘lov buyurtma holatini avtomatik yangilaydi.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Mijoz")}>
            <Select
              value={form.customer_id ?? NONE}
              onValueChange={(value) =>
                setForm((f) => ({
                  ...f,
                  customer_id: value === NONE ? null : value,
                  order_id: null,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Tanlanmagan")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("Tanlanmagan")}</SelectItem>
                {(pickers.data?.customers ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name ?? "Ismsiz"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Buyurtma")}>
            <Select
              value={form.order_id ?? NONE}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, order_id: value === NONE ? null : value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Tanlanmagan")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("Tanlanmagan")}</SelectItem>
                {orders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    #{o.order_number} · {o.total}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Summa *")}>
            <Input
              type="number"
              value={String(form.amount ?? "")}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </Field>
          <Field label={t("Usul")}>
            <Select
              value={form.method ?? "cash"}
              onValueChange={(value) => setForm((f) => ({ ...f, method: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {crmLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Holat")}>
            <Select
              value={form.status ?? "paid"}
              onValueChange={(value) => setForm((f) => ({ ...f, status: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_RECORD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {crmLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Muddat")}>
            <Input
              type="date"
              value={form.due_date ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("Izoh")}>
              <Input
                value={form.note ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Bekor qilish")}
          </Button>
          <Button
            disabled={!Number(form.amount || 0) || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("Saqlash")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TaskSeed = {
  id?: string;
  title?: string;
  description?: string | null;
  assigned_member_id?: string | null;
  customer_id?: string | null;
  order_id?: string | null;
  due_date?: string | null;
  priority?: string | null;
  status?: string | null;
};

export function TaskDialog({
  open,
  onOpenChange,
  task,
  defaultCustomerId,
  label = "Yangi vazifa",
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  task?: TaskSeed | undefined;
  defaultCustomerId?: string | undefined;
  label?: string;
}) {
  const save = useServerFn(saveTask);
  const pickers = usePickers(open);
  const invalidate = useInvalidate();
  const [form, setForm] = useState<TaskSeed>({});

  useEffect(() => {
    if (open)
      setForm(
        task ?? {
          priority: "medium",
          status: "pending",
          customer_id: defaultCustomerId ?? null,
          title: "",
        },
      );
  }, [open, task, defaultCustomerId]);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          ...(form.id ? { id: form.id } : {}),
          title: (form.title ?? "").trim(),
          description: form.description ?? null,
          assigned_member_id: form.assigned_member_id ?? null,
          customer_id: form.customer_id ?? null,
          order_id: form.order_id ?? null,
          due_date: form.due_date || null,
          priority: (form.priority ?? "medium") as "low" | "medium" | "high",
          status: (form.status ?? "pending") as "pending" | "in_progress" | "completed",
        },
      }),
    onSuccess: () => {
      toast.success(t("Vazifa saqlandi"));
      invalidate();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Saqlab bo‘lmadi"))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? t("Vazifani tahrirlash") : label}</DialogTitle>
          <DialogDescription>
            {t("Keyingi qadamni yozib qo‘ying — hech narsa esdan chiqmaydi.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t("Sarlavha *")}>
              <Input
                value={t(form.title ?? "")}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t("Ali Valiyevga qo‘ng‘iroq qilish")}
              />
            </Field>
          </div>
          <Field label={t("Mijoz")}>
            <Select
              value={form.customer_id ?? NONE}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, customer_id: value === NONE ? null : value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Tanlanmagan")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("Tanlanmagan")}</SelectItem>
                {(pickers.data?.customers ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name ?? "Ismsiz"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Mas’ul")}>
            <Select
              value={form.assigned_member_id ?? NONE}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, assigned_member_id: value === NONE ? null : value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Tanlanmagan")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("Tanlanmagan")}</SelectItem>
                {(pickers.data?.assignees ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Muddat")}>
            <Input
              type="date"
              value={form.due_date ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
            />
          </Field>
          <Field label={t("Muhimlik")}>
            <Select
              value={form.priority ?? "medium"}
              onValueChange={(value) => setForm((f) => ({ ...f, priority: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {crmLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Holat")}>
            <Select
              value={form.status ?? "pending"}
              onValueChange={(value) => setForm((f) => ({ ...f, status: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {crmLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("Tavsif")}>
              <Textarea
                rows={2}
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Bekor qilish")}
          </Button>
          <Button
            disabled={!form.title?.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("Saqlash")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Universal "+ Yangi" entry point. Labels adapt to the configured industry. */
export function QuickNewButton({
  industry,
  size = "default",
}: {
  industry?: string | null | undefined;
  size?: "default" | "sm";
}) {
  const labels = quickActionLabels(industry);
  const { isHidden } = useSectionVisibility();
  const [openKey, setOpenKey] = useState<QuickActionKey | null>(null);

  // Tezkor yaratish faqat preset ochib qo'ygan bo'limga yozadi: Murojaatlar butunlay
  // o'chirilgan, Buyurtmalar presetga qarab yashirinadi, klub presetlarida esa
  // yadro bo'limlarining hech biri yo'q — tugmaning o'zi ko'rinmaydi.
  const actions = (["customer", "order", "payment", "task"] as QuickActionKey[]).filter(
    (key) => !isHidden(QUICK_ACTION_SECTIONS[key]),
  );
  if (actions.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} className="gap-1">
            <Plus className="size-4" /> {t("Yangi")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {actions.map((key) => (
            <DropdownMenuItem key={key} onSelect={() => setOpenKey(key)}>
              {labels[key]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <CustomerDialog
        open={openKey === "customer"}
        onOpenChange={(v) => setOpenKey(v ? "customer" : null)}
        title={t("Yangi {v0}", { v0: labels.customer.toLowerCase() })}
      />
      <OrderDialog
        open={openKey === "order"}
        onOpenChange={(v) => setOpenKey(v ? "order" : null)}
        label={t("Yangi {v0}", { v0: labels.order.toLowerCase() })}
      />
      <PaymentDialog
        open={openKey === "payment"}
        onOpenChange={(v) => setOpenKey(v ? "payment" : null)}
        label={t("Yangi {v0}", { v0: labels.payment.toLowerCase() })}
      />
      <TaskDialog
        open={openKey === "task"}
        onOpenChange={(v) => setOpenKey(v ? "task" : null)}
        label={t("Yangi {v0}", { v0: labels.task.toLowerCase() })}
      />
    </>
  );
}
