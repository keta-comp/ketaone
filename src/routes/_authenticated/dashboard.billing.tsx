import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatusBadge } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { computeAccess, daysLeft, PLAN_KEYS, PLANS, type PlanKey } from "@/lib/billing";
import { createCheckout, getBilling } from "@/lib/billing.functions";
import { formatMoney } from "@/lib/types";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/billing")({
  head: () => ({
    meta: [
      { title: t("Tarif va to‘lov — KetaOne") },
      { name: "description", content: t("Tarifni tanlang va Payme yoki Click orqali to‘lang.") },
      { property: "og:title", content: t("Tarif va to‘lov — KetaOne") },
      { property: "og:description", content: t("Tarifni tanlang va Payme yoki Click orqali to‘lang.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingPage,
});

const FEATURES: Record<PlanKey, string[]> = {
  start: ["2 ta xodim", "Mijozlar, murojaatlar, buyurtmalar", "To‘lovlar va vazifalar"],
  pro: ["5 ta xodim", "Start'dagi hammasi", "AI yordamchi", "Excel eksport", "Telegram hisobotlar"],
  max: ["Cheksiz xodim", "Pro'dagi hammasi", "Ustuvor yordam"],
};

export function useBilling() {
  const fetchBilling = useServerFn(getBilling);
  return useQuery({ queryKey: ["billing"], queryFn: () => fetchBilling(), staleTime: 60_000 });
}

function BillingPage() {
  const q = useBilling();
  const checkout = useServerFn(createCheckout);
  const [busy, setBusy] = useState<string | null>(null);
  const b = q.data;
  const access = b ? computeAccess(b) : null;

  const pay = async (plan: PlanKey, provider: "payme" | "click") => {
    setBusy(plan + provider);
    try {
      const { url } = await checkout({ data: { plan, provider, returnUrl: `${window.location.origin}/dashboard/billing` } });
      window.location.href = url;
    } catch (e) {
      toast.error(friendlyError(e instanceof Error ? t(e.message) : "", t("Xatolik")));
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title={t("Tarif va to‘lov")} description={t("Ro‘yxatdan o‘tgach 7 kun bepul. Keyin tarifni tanlang.")} />

      {b && (
        <div className="clay-panel p-5">
          {access === "trial" && (
            <p className="font-medium">{t("Bepul sinov: {n} kun qoldi", { n: daysLeft(b.trial_ends_at) })}</p>
          )}
          {access === "active" && (
            <p className="font-medium">
              {t("Faol tarif: {plan}", { plan: PLANS[b.plan as PlanKey]?.name ?? b.plan ?? "—" })} ·{" "}
              {t("{n} kun qoldi", { n: daysLeft(b.subscription_ends_at) })}
            </p>
          )}
          {access === "expired" && (
            <p className="font-medium">{t("Bepul muddat tugadi. CRMdan foydalanish uchun tarifni to‘lang.")}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_KEYS.map((key) => {
          const plan = PLANS[key];
          return (
            <div key={key} className="clay-panel flex flex-col gap-4 p-6">
              <div>
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {formatMoney(plan.price, t("so‘m"))}
                  <span className="text-sm font-normal text-muted-foreground"> / {t("oy")}</span>
                </p>
              </div>
              <ul className="flex-1 space-y-2 text-sm">
                {FEATURES[key].map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="size-4 shrink-0" /> {t(f)}
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={!b?.providers.payme || !!busy} onClick={() => pay(key, "payme")}>
                  Payme
                </Button>
                <Button variant="outline" disabled={!b?.providers.click || !!busy} onClick={() => pay(key, "click")}>
                  Click
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {b && !b.providers.payme && !b.providers.click && (
        <p className="text-sm text-muted-foreground">{t("To‘lov tizimlari tez orada ulanadi.")}</p>
      )}

      {b && b.invoices.length > 0 && (
        <div className="clay-panel p-4">
          <h3 className="mb-3 font-semibold">{t("To‘lovlar tarixi")}</h3>
          <div className="space-y-2 text-sm">
            {b.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2">
                <span>#{inv.invoice_no} · {PLANS[inv.plan as PlanKey]?.name ?? inv.plan} · {inv.provider}</span>
                <span className="tabular-nums">{formatMoney(inv.amount, t("so‘m"))}</span>
                <StatusBadge value={inv.status} />
                <span className="text-xs text-muted-foreground">{new Date(inv.created_at).toLocaleDateString("uz-UZ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
