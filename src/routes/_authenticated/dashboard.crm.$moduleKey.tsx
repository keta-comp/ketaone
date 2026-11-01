import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  removeCrmAttachments,
} from "@/lib/crm-config.functions";
import { LIVE_REFETCH_MS } from "@/lib/polling";
import { crmConfigForPreset, isModuleEnabled, resolvePresetId } from "@/lib/presets";
import { relationIdKey, type CrmField, type CrmModule } from "@/lib/crm-config";
import { AttachmentCell, AttachmentField } from "@/components/app/CrmAttachment";
import { RelationCombobox } from "@/components/app/RelationCombobox";
import { Link } from "@tanstack/react-router";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/dashboard/crm/$moduleKey")({
  head: () => ({ meta: [{ title: t("CRM moduli — KetaOne") }] }),
  component: CrmModulePage,
});

type RecordRow = {
  id: string;
  title: string;
  stage: string | null;
  data: Record<string, unknown>;
  created_at: string;
};

/**
 * Nomlanuvchi maydon bo'sh qolganda (masalan, tezan-qo'shilgan yozuv) oldingi
 * nomni saqlab qolamiz — aks holda saqlash yozuvni "Nomsiz"ga aylantiradi.
 */
function recordTitle(module: CrmModule, form: Record<string, string>, previous?: string): string {
  const key = module.titleField ?? module.fields?.[0]?.key ?? "";
  return String(form[key] ?? "").trim() || String(previous ?? "").trim() || "Nomsiz";
}

function CrmModulePage() {
  const { moduleKey } = Route.useParams();
  const queryClient = useQueryClient();

  const fetchConfig = useServerFn(getMyCrmConfig);
  const fetchRecords = useServerFn(listCrmRecords);
  const saveRecord = useServerFn(saveCrmRecord);
  const removeRecord = useServerFn(deleteCrmRecord);

  const config = useQuery({ queryKey: ["crm-config"], queryFn: () => fetchConfig() });
  const [search, setSearch] = useState("");

  const records = useQuery({
    queryKey: ["crm-records", moduleKey],
    queryFn: () => fetchRecords({ data: { moduleKey } }),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const module = useMemo(() => {
    const cfg = config.data?.config;
    return cfg?.modules.find((m) => m.key === moduleKey && !m.link) ?? null;
  }, [config.data, moduleKey]);

  // Modullar yadro sahifasiga ko'chgan (Davomat → /dashboard/attendance) — eski havolani shu yerga yuboramiz.
  const movedTo = useMemo(() => {
    const cfg = config.data?.config;
    return cfg?.modules.find((m) => m.key === moduleKey && m.link)?.link ?? null;
  }, [config.data, moduleKey]);

  // Preset bu modumni o'chirgan (salonda Xizmatlar artiq haqiqiy sahifa) — saqlangan
  // konfiguratsiyada modul hali tursa ham uning formasi ochilmaydi. Bunday modullar
  // reestrdagi havolasi bo'lsa, o'sha haqiqiy sahifaga yuboriladi.
  const hiddenMovedTo = useMemo(() => {
    const cfg = config.data?.config;
    if (!cfg || !module) return null;
    const presetId = resolvePresetId(config.data?.industry, cfg.presetId);
    if (isModuleEnabled(presetId, moduleKey)) return null;
    return crmConfigForPreset(presetId).modules.find((m) => m.key === moduleKey)?.link ?? null;
  }, [config.data, module, moduleKey]);

  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    const initial: Record<string, string> = {};
    (module?.fields ?? []).forEach((f) => {
      initial[f.key] = "";
      if (f.type === "relation") initial[relationIdKey(f.key)] = "";
    });
    setForm(initial);
    setStage(module?.pipeline ? (config.data?.config?.pipelineStages[0] ?? "") : "");
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (row: RecordRow) => {
    const initial: Record<string, string> = {};
    (module?.fields ?? []).forEach((f) => {
      const v = row.data?.[f.key];
      initial[f.key] = v === null || v === undefined ? "" : String(v);
      if (f.type === "relation") {
        const idv = row.data?.[relationIdKey(f.key)];
        initial[relationIdKey(f.key)] = typeof idv === "string" ? idv : "";
      }
    });
    setForm(initial);
    setStage(row.stage ?? "");
    setEditing(row);
    setCreating(false);
  };

  const submit = async () => {
    if (!module) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = {};
      for (const f of module.fields ?? []) {
        if (f.required && !String(form[f.key] ?? "").trim()) {
          toast.error(t("\"{v0}\" maydonini to‘ldiring", { v0: t(f.label) }));
          return;
        }
        data[f.key] = form[f.key] ?? "";
        if (f.type === "relation") data[relationIdKey(f.key)] = form[relationIdKey(f.key)] || null;
      }
      const title = recordTitle(module, form, editing?.title);
      await saveRecord({
        data: { id: editing?.id, moduleKey: module.key, title, stage: stage || null, data },
      });
      const dropped = replacedAttachments(module.fields ?? [], editing?.data, form);
      if (dropped.length) {
        await removeCrmAttachments({ data: { moduleKey: module.key, paths: dropped } }).catch(
          () => undefined,
        );
      }
      await records.refetch();
      void queryClient.invalidateQueries({ queryKey: ["crm-widgets"] });
      setCreating(false);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const files = recordAttachments(module?.fields ?? [], editing.data);
      await removeRecord({ data: { id: editing.id, moduleKey } });
      if (files.length) {
        await removeCrmAttachments({ data: { moduleKey, paths: files } }).catch(() => undefined);
      }
      await records.refetch();
      void queryClient.invalidateQueries({ queryKey: ["crm-widgets"] });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  if (config.isPending) return <LoadingState />;
  if (config.error) return <ErrorState error={config.error} onRetry={() => void config.refetch()} />;
  if (movedTo || hiddenMovedTo) return <Navigate to={movedTo ?? hiddenMovedTo ?? "/dashboard"} replace />;
  if (!module) {
    return <EmptyState title={t("Modul topilmadi")} description={t("Bu modul CRM konfiguratsiyasida mavjud emas.")} />;
  }

  const fields = module.fields ?? [];
  const rows = (records.data ?? []) as unknown as RecordRow[];
  const filtered = rows.filter((r) =>
    search ? r.title.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <>
      <PageHeader
        title={t(module.label)}
        description={module.pipeline ? t("Pipeline bosqichlari bilan kuzatiladi") : ""}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-44 pl-9 sm:w-60"
                placeholder={t("Qidirish…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" /> {t("Yangi qo‘shish")}
            </Button>
          </div>
        }
      />

      <section className="clay-panel overflow-hidden">
        {records.isPending ? (
          <LoadingState />
        ) : records.error ? (
          <ErrorState error={records.error} onRetry={() => void records.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t("Hozircha yozuv yo‘q")}
            description={t("\"{v0}\" bo‘limiga birinchi yozuvni qo‘shing.", { v0: module.label })}
          />
        ) : (
          <>
            <div className="grid gap-2 p-4 sm:hidden">
              {filtered.map((row) => (
                <div
                  key={row.id}
                  className="clay-inset cursor-pointer p-4"
                  onClick={() => openEdit(row)}
                >
                  <p className="text-sm font-medium">{row.title}</p>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    {fields.slice(0, 5).map((f) => (
                      <p key={f.key} className="flex flex-wrap items-baseline gap-1">
                        <span>{t(f.label)}:</span>
                        <span className="min-w-0 break-words text-foreground">
                          <CellValue field={f} data={row.data} moduleKey={module.key} />
                        </span>
                      </p>
                    ))}
                    {module.pipeline && (
                      <p className="flex flex-wrap items-baseline gap-1">
                        <span>{t("Bosqich")}:</span>
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {t(row.stage ?? "—")}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Trash2
                      className="size-4 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeRecord({ data: { id: row.id, moduleKey } }).then(() => void records.refetch());
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {fields.slice(0, 5).map((f) => (
                    <th key={f.key} className="px-4 py-3 font-medium">
                      {t(f.label)}
                    </th>
                  ))}
                  {module.pipeline && <th className="px-4 py-3 font-medium">{t("Bosqich")}</th>}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-card"
                    onClick={() => openEdit(row)}
                  >
                    {fields.slice(0, 5).map((f) => (
                      <td key={f.key} className="max-w-56 truncate px-4 py-3">
                        <CellValue field={f} data={row.data} moduleKey={module.key} />
                      </td>
                    ))}
                    {module.pipeline && (
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {t(row.stage ?? "—")}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <Trash2
                        className="ml-auto size-4 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeRecord({ data: { id: row.id, moduleKey } }).then(() => void records.refetch());
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>

      <Dialog open={creating || !!editing} onOpenChange={(open) => { if (!open) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("{v0}ni tahrirlash", { v0: module.label }) : t("Yangi {v0}", { v0: module.label.toLowerCase() })}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {fields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                moduleKey={module.key}
                value={form[field.key] ?? ""}
                relationId={form[relationIdKey(field.key)] ?? ""}
                onChange={(v) => setForm((prev) => ({ ...prev, [field.key]: v }))}
                onRelationChange={(rel) =>
                  setForm((prev) => ({
                    ...prev,
                    [field.key]: rel?.label ?? "",
                    [relationIdKey(field.key)]: rel?.id ?? "",
                  }))
                }
              />
            ))}
            {module.pipeline && (
              <div className="flex flex-col gap-2">
                <Label>{t("Bosqich")}</Label>
                <Select value={t(stage)} onValueChange={setStage}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("Bosqichni tanlang")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(config.data?.config?.pipelineStages ?? []).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {editing && (
              <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={saving}>
                <Trash2 className="size-4" /> {t("O‘chirish")}
              </Button>
            )}
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? t("Saqlanmoqda…") : t("Saqlash")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CellValue({
  field,
  data,
  moduleKey,
}: {
  field: CrmField;
  data: Record<string, unknown>;
  moduleKey: string;
}) {
  const text = String(data?.[field.key] ?? "") || "—";
  if (field.type === "file") {
    return <AttachmentCell moduleKey={moduleKey} path={String(data?.[field.key] ?? "")} />;
  }
  const id = data?.[relationIdKey(field.key)];
  if (field.type !== "relation" || typeof id !== "string" || !id) return <>{text}</>;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (field.targetModule === "customers") {
    return (
      <Link to="/dashboard/customers/$id" params={{ id }} onClick={stop} className="font-medium underline underline-offset-2">
        {text}
      </Link>
    );
  }
  // Xodim (shifokor/usta) sahifasi bitta yozuvga havola bermaydi — ro'yxatga olib ketadi.
  if (field.targetModule === "employees") {
    return (
      <Link to="/dashboard/employees" onClick={stop} className="font-medium underline underline-offset-2">
        {text}
      </Link>
    );
  }
  return (
    <Link
      to="/dashboard/crm/$moduleKey"
      params={{ moduleKey: field.targetModule ?? "" }}
      onClick={stop}
      className="font-medium underline underline-offset-2"
    >
      {text}
    </Link>
  );
}

function FieldInput({
  field,
  moduleKey,
  value,
  relationId,
  onChange,
  onRelationChange,
}: {
  field: CrmField;
  moduleKey: string;
  value: string;
  relationId: string;
  onChange: (value: string) => void;
  onRelationChange: (value: { id: string; label: string } | null) => void;
}) {
  const label = (
    <Label>
      {t(field.label)}
      {field.required && <span className="text-destructive"> *</span>}
    </Label>
  );
  if (field.type === "file") {
    return (
      <div className="flex flex-col gap-2">
        {label}
        <AttachmentField moduleKey={moduleKey} value={value} onChange={onChange} />
      </div>
    );
  }
  if (field.type === "relation" && field.targetModule) {
    return (
      <div className="flex flex-col gap-2">
        {label}
        <RelationCombobox
          targetModule={field.targetModule}
          value={value ? { id: relationId, label: value } : null}
          onChange={onRelationChange}
        />
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className="flex flex-col gap-2">
        {label}
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder={t("Tanlang")} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (field.type === "textarea") {
    return (
      <div className="flex flex-col gap-2">
        {label}
        <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  const inputType =
    field.type === "number" || field.type === "money"
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "time"
          ? "time"
          : field.type === "phone"
            ? "tel"
            : "text";
  return (
    <div className="flex flex-col gap-2">
      {label}
      <Input type={inputType} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Object paths the edit session replaced or detached — the stored files go with them. */
function replacedAttachments(
  fields: CrmField[],
  before: Record<string, unknown> | undefined,
  after: Record<string, string>,
): string[] {
  if (!before) return [];
  return fields
    .filter((f) => f.type === "file")
    .map((f) => ({ old: String(before[f.key] ?? ""), next: after[f.key] ?? "" }))
    .filter((pair) => pair.old && pair.old !== pair.next)
    .map((pair) => pair.old);
}

/** Deleting a record must not leave its attachments behind. */
function recordAttachments(fields: CrmField[], data: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.type === "file")
    .map((f) => String(data[f.key] ?? ""))
    .filter(Boolean);
}
