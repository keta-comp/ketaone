import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { listCustomerLinkedRecords } from "@/lib/crm-config.functions";
import { intlLocale, t } from "@/lib/i18n";

export function useCustomerLinkedRecords(customerId: string) {
  const fetch = useServerFn(listCustomerLinkedRecords);
  return useQuery({
    queryKey: ["customer-linked", customerId],
    queryFn: () => fetch({ data: { customerId } }),
  });
}

export function CustomerLinkedRecords({ customerId }: { customerId: string }) {
  const q = useCustomerLinkedRecords(customerId);
  const rows = q.data ?? [];
  if (q.isPending) return <p className="text-sm text-muted-foreground">{t("Yuklanmoqda…")}</p>;
  if (rows.length === 0) return <p className="clay-panel p-5 text-sm text-muted-foreground">{t("Bog‘langan yozuvlar yo‘q")}</p>;
  return (
    <>
      {rows.map((r) => (
        <Link
          key={r.id}
          to="/dashboard/crm/$moduleKey"
          params={{ moduleKey: r.moduleKey }}
          className="clay-panel flex items-center justify-between p-4 text-sm hover:bg-card"
        >
          <div>
            <p className="font-medium">{r.title}</p>
            <p className="text-xs text-muted-foreground">
              {t(r.moduleLabel)} · {new Date(r.created_at).toLocaleDateString(intlLocale())}
            </p>
          </div>
          {r.stage && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs">{t(r.stage)}</span>}
        </Link>
      ))}
    </>
  );
}
