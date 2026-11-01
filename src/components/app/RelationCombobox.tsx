import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { saveCrmRecord, searchRelatedRecords } from "@/lib/crm-config.functions";
import { saveCrmCustomer } from "@/lib/customers.functions";
import { saveEmployee } from "@/lib/employees.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export interface RelationValue {
  id: string;
  label: string;
}

export function RelationCombobox({
  targetModule,
  value,
  onChange,
}: {
  targetModule: string;
  value: RelationValue | null;
  onChange: (value: RelationValue | null) => void;
}) {
  const search = useServerFn(searchRelatedRecords);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(id);
  }, [term]);

  const results = useQuery({
    queryKey: ["relation-search", targetModule, debounced],
    queryFn: () => search({ data: { targetModule, search: debounced } }),
    enabled: open,
  });

  const saveCustomer = useServerFn(saveCrmCustomer);
  const saveRecord = useServerFn(saveCrmRecord);
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  /**
   * Tezan qo'shishda nom faqat title'ga tushsa, modul jadvalidagi maydonlar
   * bo'sh qoladi (ular title'ni ko'rsatmaydi). Shablondagi nomlovchi maydonni
   * oldindan to'ldirib, qatorni ko'rinadigan qilamiz.
   */
  const titleKeyOf = (moduleKey: string): string | undefined => {
    const cfg = queryClient.getQueryData<{
      config?: { modules?: { key: string; titleField?: string; fields?: { key: string }[] }[] };
    }>(["crm-config"])?.config;
    const module = cfg?.modules?.find((m) => m.key === moduleKey);
    return module?.titleField ?? module?.fields?.[0]?.key;
  };

  const quickAdd = async () => {
    const name = term.trim();
    if (!name) return;
    setAdding(true);
    try {
      const titleKey = titleKeyOf(targetModule);
      const created =
        targetModule === "customers"
          ? await saveCustomer({ data: { full_name: name } })
          : targetModule === "employees"
            ? // Shifokor/usta — CRM yozuvi emas, haqiqiy xodim.
              await saveEmployee({ data: { full_name: name } })
            : await saveRecord({
                data: {
                  moduleKey: targetModule,
                  title: name,
                  stage: null,
                  data: titleKey ? { [titleKey]: name } : {},
                },
              });
      onChange({ id: created.id, label: name });
      void queryClient.invalidateQueries({ queryKey: ["relation-search", targetModule] });
      setTerm("");
      setOpen(false);
      toast.success(t("Qo‘shildi"));
    } catch (e) {
      toast.error(friendlyError(e, t("Xatolik")));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="flex-1 justify-between font-normal">
            <span className={value ? "" : "text-muted-foreground"}>{value?.label || t("Tanlang")}</span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
          <Input autoFocus placeholder={t("Qidirish…")} value={term} onChange={(e) => setTerm(e.target.value)} />
          <div className="mt-2 max-h-60 overflow-y-auto">
            {results.isPending ? (
              <p className="p-2 text-sm text-muted-foreground">{t("Yuklanmoqda…")}</p>
            ) : (results.data ?? []).length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground">
                <p>{t("Hech narsa topilmadi")}</p>
                {term.trim() && (
                  <Button type="button" size="sm" className="mt-2 w-full" disabled={adding} onClick={() => void quickAdd()}>
                    <Plus className="size-4" /> {t("\"{v0}\" ni qo‘shish", { v0: term.trim() })}
                  </Button>
                )}
              </div>
            ) : (
              (results.data ?? []).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onChange({ id: r.id, label: r.label });
                    setOpen(false);
                  }}
                >
                  <span>
                    {r.label}
                    {r.hint && <span className="ml-2 text-xs text-muted-foreground">{r.hint}</span>}
                  </span>
                  {value?.id === r.id && <Check className="size-4" />}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <Button type="button" variant="ghost" size="icon" aria-label={t("Tozalash")} onClick={() => onChange(null)}>
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
