/**
 * Xizmatlar katalogi — `services` jadvali ustidagi editor.
 *
 * Bu xizmatlar bron sahifasi, onlayn qabul va depozit hisobi uchun haqiqiy manba,
 * shuning uchun ular `products` (SKU, zaxira) katalogiga aralashtirilmaydi.
 * Qabul va bron sahifasidagi «Xizmatlar» tab'i va soha sahifasi shu bitta
 * komponentni ko'rsatadi: narxni ikki joyda boshqarib bo'lmasligi uchun.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { deleteService, listServices, saveService } from "@/lib/appointments.functions";
import { DEPOSIT_TYPES, DEPOSIT_TYPE_LABELS, depositFor, type DepositType } from "@/lib/deposit";
import { listServiceTeam } from "@/lib/employees.functions";
import { t } from "@/lib/i18n";
import { useTerminology } from "@/lib/terminology";
import { formatMoney } from "@/lib/types";

type ServiceSaveInput = {
  id?: string;
  name: string;
  duration_minutes: number;
  price: number;
  is_active?: boolean;
  deposit_type?: DepositType;
  deposit_value?: number;
};

const EMPTY_FORM = {
  name: "",
  duration_minutes: "30",
  price: "",
  deposit_type: "none" as DepositType,
  deposit_value: "",
};

/**
 * Katalog `services` jadvali bir xil, lekin klubda u «Qurilmalar va stollar» deb ataladi.
 * So'zlarni komponent chaqiruvchisi beradi, shunda sahifa sarlavhasi bilan form matni
 * bir-biriga zid qolmaydi.
 */
export type CatalogLabels = {
  name: string;
  add: string;
  remove: string;
  saved: string;
  deleted: string;
  empty: string;
  emptyHint: string;
};

const DEFAULT_LABELS: CatalogLabels = {
  name: "Xizmat nomi",
  add: "Xizmat qo'shish",
  remove: "Xizmatni o'chirish",
  saved: "Xizmat saqlandi",
  deleted: "Xizmat o'chirildi",
  empty: "Xizmatlar yo'q",
  emptyHint: "Bron qilish uchun avval xizmat qo'shing.",
};

/** Klub menyu va bron sahifasi shu nom bilan yozadi — ikki sahifa janjal bo'lmasligi uchun bir joyda. */
export const CLUB_CATALOG_LABELS: CatalogLabels = {
  name: "Qurilma yoki stol nomi",
  add: "Qurilma/stol qo'shish",
  remove: "Qurilmani o'chirish",
  saved: "Qurilma saqlandi",
  deleted: "Qurilma o'chirildi",
  empty: "Qurilmalar va stollar yo'q",
  emptyHint: "Bron uchun avval qurilma yoki stol qo'shing.",
};

/** Xizmat qatoridagi depozit qoidasi: sayt egasi jadvaldan chiqmasdan sozlaydi. */
function DepositRuleCell({
  service,
  disabled,
  onSave,
}: {
  service: {
    id: string;
    name: string;
    duration_minutes: number;
    price: string | number;
    is_active: boolean;
    deposit_type: string | null;
    deposit_value: string | number | null;
  };
  disabled: boolean;
  onSave: (input: ServiceSaveInput) => void;
}) {
  const [type, setType] = useState<DepositType>(
    DEPOSIT_TYPES.includes(service.deposit_type as DepositType)
      ? (service.deposit_type as DepositType)
      : "none",
  );
  const [value, setValue] = useState(() => String(Number(service.deposit_value) || 0));

  const commit = (nextType: DepositType, nextValue: number) => {
    onSave({
      id: service.id,
      name: service.name,
      duration_minutes: service.duration_minutes,
      price: Number(service.price),
      is_active: service.is_active,
      deposit_type: nextType,
      deposit_value: nextType === "none" ? 0 : nextValue,
    });
  };

  const deposit = depositFor(
    { deposit_type: type, deposit_value: Number(value) || 0 },
    Number(service.price),
  );

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <Select
          disabled={disabled}
          value={type}
          onValueChange={(next) => {
            const nextType = next as DepositType;
            setType(nextType);
            commit(nextType, Number(value) || 0);
          }}
        >
          <SelectTrigger className="h-8 w-[7.5rem]" aria-label={t("Depozit turi")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEPOSIT_TYPES.map((option) => (
              <SelectItem key={option} value={option}>
                {t(DEPOSIT_TYPE_LABELS[option])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {type !== "none" ? (
          <Input
            className="h-8 w-24"
            type="number"
            min="0"
            max={type === "percent" ? "100" : "1000000000"}
            step="100"
            value={value}
            aria-label={type === "percent" ? t("% miqdori") : t("Summa (so‘m)")}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => commit(type, Number(value) || 0)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(type, Number(value) || 0);
              }
            }}
          />
        ) : null}
      </div>
      {deposit > 0 ? (
        <p className="text-xs tabular-nums text-muted-foreground">
          {t("Depozit: {sum}", { sum: formatMoney(deposit) })}
        </p>
      ) : null}
    </div>
  );
}

export function ServicesCatalog({
  labels = DEFAULT_LABELS,
}: {
  labels?: CatalogLabels | undefined;
} = {}) {
  const queryClient = useQueryClient();
  const { term } = useTerminology();
  const staff = term("employees");

  const fetchServices = useServerFn(listServices);
  const fetchTeam = useServerFn(listServiceTeam);
  const save = useServerFn(saveService);
  const remove = useServerFn(deleteService);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const services = useQuery({
    queryKey: ["services", "all"],
    queryFn: () => fetchServices({ data: { includeInactive: true } }),
  });
  const team = useQuery({ queryKey: ["service-team"], queryFn: () => fetchTeam({ data: {} }) });

  const mastersByService = useMemo(() => {
    const byService = new Map<string, string[]>();
    for (const link of team.data ?? []) {
      byService.set(link.serviceId, [...(byService.get(link.serviceId) ?? []), link.fullName]);
    }
    return byService;
  }, [team.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["services"] });
    void queryClient.invalidateQueries({ queryKey: ["service-team"] });
  };

  const saveMutation = useMutation({
    mutationFn: (input: ServiceSaveInput) => save({ data: input }),
    onSuccess: () => {
      toast.success(t(labels.saved));
      setForm(EMPTY_FORM);
      setEditingId(null);
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t("Amalga oshmadi")),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t(labels.deleted));
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t("Amalga oshmadi")),
  });

  const submit = () => {
    const duration = Number(form.duration_minutes || 30);
    const price = Number(form.price || 0);
    const depositValue = Number(form.deposit_value || 0);
    const editing = (services.data ?? []).find((service) => service.id === editingId);
    saveMutation.mutate({
      ...(editingId ? { id: editingId } : {}),
      name: form.name,
      duration_minutes: duration,
      price,
      ...(editing ? { is_active: editing.is_active } : {}),
      deposit_type: form.deposit_type,
      deposit_value: form.deposit_type === "none" ? 0 : depositValue,
    });
  };

  return (
    <div className="grid gap-4">
      <form
        className="clay-panel flex flex-wrap items-end gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="min-w-52 flex-1">
          <Label htmlFor="svc-name">{t(labels.name)}</Label>
          <Input
            id="svc-name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="svc-duration">{t("Davomiylik (min)")}</Label>
          <Input
            id="svc-duration"
            type="number"
            min="1"
            max="1440"
            required
            className="w-32"
            value={form.duration_minutes}
            onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="svc-price">{t("Narx")}</Label>
          <Input
            id="svc-price"
            type="number"
            min="0"
            step="0.01"
            className="w-40"
            value={form.price}
            onChange={(event) => setForm({ ...form, price: event.target.value })}
            placeholder="0"
          />
        </div>
        <div>
          <Label htmlFor="svc-deposit-type">{t("Depozit")}</Label>
          <Select
            value={form.deposit_type}
            onValueChange={(value) => setForm({ ...form, deposit_type: value as DepositType })}
          >
            <SelectTrigger id="svc-deposit-type" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPOSIT_TYPES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(DEPOSIT_TYPE_LABELS[option])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {form.deposit_type !== "none" ? (
          <div>
            <Label htmlFor="svc-deposit-value">
              {form.deposit_type === "percent" ? t("% miqdori") : t("Summa (so‘m)")}
            </Label>
            <Input
              id="svc-deposit-value"
              type="number"
              min="0"
              max={form.deposit_type === "percent" ? "100" : "1000000000"}
              step="100"
              className="w-32"
              value={form.deposit_value}
              onChange={(event) => setForm({ ...form, deposit_value: event.target.value })}
              placeholder="0"
            />
          </div>
        ) : null}
        <Button type="submit" disabled={saveMutation.isPending}>
          {editingId ? t("Saqlash") : t(labels.add)}
        </Button>
        {editingId ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditingId(null);
              setForm(EMPTY_FORM);
            }}
          >
            {t("Bekor qilish")}
          </Button>
        ) : null}
      </form>

      {services.isPending ? (
        <LoadingState />
      ) : services.error ? (
        <ErrorState error={services.error} onRetry={() => void services.refetch()} />
      ) : (services.data ?? []).length === 0 ? (
        <EmptyState title={t(labels.empty)} description={t(labels.emptyHint)} />
      ) : (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t(labels.name)}</th>
                <th className="px-4 py-3">{t("Davomiylik (min)")}</th>
                <th className="px-4 py-3">{t("Narx")}</th>
                <th className="px-4 py-3">{t("Depozit qoidasi")}</th>
                <th className="px-4 py-3">{staff.many}</th>
                <th className="px-4 py-3">{t("Faol")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(services.data ?? []).map((service) => {
                const masters = mastersByService.get(service.id) ?? [];
                return (
                  <tr key={service.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{service.name}</td>
                    <td className="px-4 py-3 tabular-nums">{service.duration_minutes}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(Number(service.price))}</td>
                    <td className="px-4 py-3">
                      <DepositRuleCell
                        service={{
                          id: service.id,
                          name: service.name,
                          duration_minutes: service.duration_minutes,
                          price: service.price,
                          is_active: service.is_active,
                          deposit_type: service.deposit_type ?? null,
                          deposit_value: service.deposit_value ?? null,
                        }}
                        disabled={saveMutation.isPending}
                        onSave={(input) => saveMutation.mutate(input)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {masters.length === 0 ? (
                        <span className="text-muted-foreground">
                          {t("{many} biriktirilmagan", { many: staff.one.toLowerCase() })}
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {masters.map((name) => (
                            <span
                              key={name}
                              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {name}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={service.is_active}
                        disabled={saveMutation.isPending}
                        onCheckedChange={(checked) =>
                          saveMutation.mutate({
                            id: service.id,
                            name: service.name,
                            duration_minutes: service.duration_minutes,
                            price: Number(service.price),
                            is_active: checked,
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={saveMutation.isPending}
                          onClick={() => {
                            setEditingId(service.id);
                            setForm({
                              name: service.name,
                              duration_minutes: String(service.duration_minutes),
                              price: String(service.price),
                              deposit_type: (service.deposit_type ?? "none") as DepositType,
                              deposit_value: String(Number(service.deposit_value) || 0),
                            });
                          }}
                        >
                          {t("Tahrirlash")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t(labels.remove)}
                          disabled={removeMutation.isPending}
                          onClick={() => removeMutation.mutate(service.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
