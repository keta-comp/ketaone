import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { RelationCombobox } from "@/components/app/RelationCombobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  deleteCrmRecord,
  getMyCrmConfig,
  listCrmRecords,
  saveCrmRecord,
} from "@/lib/crm-config.functions";
import {
  LOWER_TEETH,
  ODONTOGRAMMA_MODULE,
  TOOTH_CONDITIONS,
  UPPER_TEETH,
  conditionStyle,
  dentalSummary,
  findingsByTooth,
  odontogramTitle,
  quadrantName,
  toFindingData,
  toFindingDraft,
  toToothFinding,
  toothName,
  type ToothFinding,
  type ToothFindingDraft,
} from "@/lib/dental";
import { isModuleEnabled, resolvePresetId } from "@/lib/presets";
import { can } from "@/lib/roles";
import { formatMoney } from "@/lib/types";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

type FindingRow = { id: string; created_at: string; data: Record<string, unknown> | null };

/** The chart only exists for tenants whose CRM offers the odontogramma module. */
export function useOdontogrammaEnabled(): { enabled: boolean; loading: boolean } {
  const fetchConfig = useServerFn(getMyCrmConfig);
  const config = useQuery({ queryKey: ["crm-config"], queryFn: () => fetchConfig() });
  const presetId = resolvePresetId(config.data?.industry, config.data?.config?.presetId);
  const configured = !!config.data?.config?.modules.some((m) => m.key === ODONTOGRAMMA_MODULE && !m.link);
  const mayView = can(config.data?.role, "medical.view");
  return { loading: config.isPending, enabled: configured && mayView && isModuleEnabled(presetId, ODONTOGRAMMA_MODULE) };
}

export function DentalChart({ customerId, patientName }: { customerId: string; patientName: string }) {
  const queryClient = useQueryClient();
  const fetchRecords = useServerFn(listCrmRecords);
  const saveRecord = useServerFn(saveCrmRecord);
  const removeRecord = useServerFn(deleteCrmRecord);

  const [selected, setSelected] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ToothFindingDraft>(toFindingDraft(null));
  const [saving, setSaving] = useState(false);

  const { enabled, loading } = useOdontogrammaEnabled();

  const records = useQuery({
    queryKey: ["crm-records", ODONTOGRAMMA_MODULE],
    queryFn: () => fetchRecords({ data: { moduleKey: ODONTOGRAMMA_MODULE } }),
    enabled,
  });

  const findings = useMemo(
    () =>
      ((records.data ?? []) as unknown as FindingRow[])
        .map(toToothFinding)
        .filter((f) => f.patientId === customerId),
    [records.data, customerId],
  );
  const grouped = findingsByTooth(findings);
  const summary = dentalSummary(findings);
  const editingFinding = findings.find((f) => f.id === editingId) ?? null;

  const setField = <K extends keyof ToothFindingDraft>(key: K, value: ToothFindingDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const openCreate = (tooth: number) => {
    setEditingId(null);
    setDraft(toFindingDraft(null));
    setSelected(tooth);
    setOpen(true);
  };

  const openEdit = (finding: ToothFinding) => {
    setEditingId(finding.id);
    setDraft(toFindingDraft(finding));
    setOpen(true);
  };

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crm-records", ODONTOGRAMMA_MODULE] }),
      queryClient.invalidateQueries({ queryKey: ["customer-linked", customerId] }),
      queryClient.invalidateQueries({ queryKey: ["crm-widgets"] }),
    ]);

  const submit = async () => {
    const tooth = editingFinding?.tooth ?? selected;
    if (tooth === null) return;
    if (!draft.condition.trim()) {
      toast.error(t("Holatni tanlang"));
      return;
    }
    setSaving(true);
    try {
      await saveRecord({
        data: {
          id: editingId ?? undefined,
          moduleKey: ODONTOGRAMMA_MODULE,
          title: odontogramTitle({ tooth, condition: draft.condition.trim() }),
          stage: null,
          data: toFindingData({
            ...draft,
            tooth,
            patient: patientName,
            patientId: customerId,
            condition: draft.condition.trim(),
            recommendation: draft.recommendation.trim(),
          }),
        },
      });
      await refresh();
      setOpen(false);
      toast.success(t("Odontogramma saqlandi"));
    } catch (error) {
      toast.error(friendlyError(error, t("Xatolik")));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (finding: ToothFinding) => {
    try {
      await removeRecord({ data: { id: finding.id } });
      await refresh();
      toast.success(t("Yozuv o‘chirildi"));
    } catch (error) {
      toast.error(friendlyError(error, t("Xatolik")));
    }
  };

  if (loading || records.isPending) {
    return <p className="clay-panel p-5 text-sm text-muted-foreground">{t("Yuklanmoqda…")}</p>;
  }

  if (!enabled) {
    return (
      <div className="clay-panel space-y-2 p-5">
        <p className="text-sm font-medium">{t("Odontogramma moduli yoqilmagan")}</p>
        <p className="text-sm text-muted-foreground">
          {t("Tish xaritasini yoqish uchun biznes turini yangilang yoki AI CRM sozlashda modul qo‘shing.")}
        </p>
        <Link to="/dashboard/settings" className="text-xs font-medium text-primary underline underline-offset-4">
          {t("Sozlamalarni ochish")}
        </Link>
      </div>
    );
  }

  const selectedList = selected === null ? [] : (grouped.get(selected) ?? []);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label={t("Yozilgan tishlar")} value={String(summary.recorded)} />
        <Metric label={t("E‘tibor kerak")} value={String(summary.attention)} tone="alert" />
        <Metric label={t("Yo‘qolgan tishlar")} value={String(summary.missing)} />
        <Metric
          label={t("Rejadagi muolajalar")}
          value={`${summary.planned} • ${formatMoney(summary.plannedCost, "UZS")}`}
        />
      </div>

      <section className="clay-panel space-y-3 p-4">
        <ToothArch
          teeth={UPPER_TEETH}
          label={t("Yuqori jag‘")}
          grouped={grouped}
          active={selected}
          onSelect={setSelected}
        />
        <ToothArch
          teeth={LOWER_TEETH}
          label={t("Pastki jag‘")}
          grouped={grouped}
          active={selected}
          onSelect={setSelected}
        />
        <Legend />
      </section>

      <section className="clay-panel p-4">
        {selected === null ? (
          <p className="text-sm text-muted-foreground">{t("Tishni tanlash uchun xaritadagi raqamni bosing.")}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  {t("Tish {v0}", { v0: selected })} — {t(toothName(selected))} ({t(quadrantName(selected))})
                </p>
                <p className="text-xs text-muted-foreground">{t("Bu tish bo‘yicha barcha qaydlar")}</p>
              </div>
              <Button size="sm" onClick={() => openCreate(selected)}>
                <Plus className="size-4" /> {t("Qayd qo‘shish")}
              </Button>
            </div>
            {selectedList.length === 0 ? (
              <p className="clay-inset rounded-2xl px-3 py-2 text-sm text-muted-foreground">
                {t("Hozircha bu tish bo‘yicha yozuv yo‘q.")}
              </p>
            ) : (
              selectedList.map((finding) => (
                <div
                  key={finding.id}
                  className="clay-inset flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      <span
                        className={cn(
                          "mr-2 rounded-full border px-2 py-0.5 text-xs",
                          conditionStyle(finding.condition),
                        )}
                      >
                        {t(finding.condition)}
                      </span>
                      {finding.date ? new Date(finding.date).toLocaleDateString("uz-UZ") : ""}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        finding.recommendation,
                        finding.doctor,
                        finding.price ? formatMoney(finding.price, "UZS") : null,
                        finding.note,
                      ]
                        .filter(Boolean)
                        .join(" • ") || t("Qo‘shimcha ma’lumot yo‘q")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="icon" variant="ghost" aria-label={t("Tahrirlash")} onClick={() => openEdit(finding)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("O‘chirish")}
                      onClick={() => void remove(finding)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t("Qaydni tahrirlash") : t("Tish {v0} — yangi qayd", { v0: selected ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>
                {t("Holat")}
                <span className="text-destructive"> *</span>
              </Label>
              <Select value={draft.condition} onValueChange={(v) => setField("condition", v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Tanlang")} />
                </SelectTrigger>
                <SelectContent>
                  {TOOTH_CONDITIONS.map((condition) => (
                    <SelectItem key={condition} value={condition}>
                      {t(condition)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("Tavsiya etilgan muolaja")}</Label>
              <Input
                value={draft.recommendation}
                onChange={(e) => setField("recommendation", e.target.value)}
                placeholder={t("Masalan: keramik koronka")}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>{t("Sana")}</Label>
                <Input type="date" value={draft.date} onChange={(e) => setField("date", e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("Narx")}</Label>
                <Input
                  type="number"
                  min="0"
                  value={draft.price}
                  onChange={(e) => setField("price", e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("Shifokor")}</Label>
              <RelationCombobox
                targetModule="employees"
                value={draft.doctor ? { id: draft.doctorId ?? "", label: draft.doctor } : null}
                onChange={(v) =>
                  setDraft((prev) => ({ ...prev, doctor: v?.label ?? "", doctorId: v?.id ?? null }))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("Izoh")}</Label>
              <Textarea rows={3} value={draft.note} onChange={(e) => setField("note", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? t("Saqlanmoqda…") : t("Saqlash")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "alert" }) {
  return (
    <div className="clay-inset rounded-2xl px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold", tone === "alert" && "text-rose-600")}>{value}</p>
    </div>
  );
}

function ToothArch({
  teeth,
  label,
  grouped,
  active,
  onSelect,
}: {
  teeth: readonly number[];
  label: string;
  grouped: Map<number, ToothFinding[]>;
  active: number | null;
  onSelect: (tooth: number) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {teeth.map((tooth) => {
          const latest = grouped.get(tooth)?.[0];
          return (
            <button
              key={tooth}
              type="button"
              title={latest ? `${t("Tish {v0}", { v0: tooth })} — ${t(latest.condition)}` : t("Yozuv yo‘q")}
              onClick={() => onSelect(tooth)}
              className={cn(
                "min-w-9 rounded-xl border px-2 py-1.5 text-xs font-semibold transition-all hover:shadow-clay-sm",
                latest ? conditionStyle(latest.condition) : "border-dashed border-border bg-card text-muted-foreground",
                active === tooth && "ring-2 ring-primary ring-offset-1",
              )}
            >
              {tooth}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
      {TOOTH_CONDITIONS.map((condition) => (
        <span key={condition} className={cn("rounded-full border px-2 py-0.5 text-[11px]", conditionStyle(condition))}>
          {t(condition)}
        </span>
      ))}
    </div>
  );
}
