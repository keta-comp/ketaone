import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";

import { DashboardShell } from "@/components/app/DashboardShell";
import { Button } from "@/components/ui/button";
import { computeAccess } from "@/lib/billing";
import { getMyCrmConfig } from "@/lib/crm-config.functions";
import { t } from "@/lib/i18n";
import { homeRouteForPreset, isRouteAllowedForPath, resolvePresetId } from "@/lib/presets";
import { useBilling } from "./dashboard.billing";

export const Route = createFileRoute("/_authenticated/dashboard")({
  // CRM sozlanmagan foydalanuvchini onboarding wizard'ga yo'naltiramiz.
  loader: async ({ location }) => {
    const config = await getMyCrmConfig();
    if (!config.hasConfig) throw redirect({ to: "/onboarding" });
    // Soha menyusi qaysi bo'limlarni umuman ko'rsatmasa, URL'ni qo'lda yozib kirib
    // bo'lmaydi — tekshiruv serverda, sahifa chiqarilmasdan oldin bajariladi.
    const presetId = resolvePresetId(config.industry, config.config?.presetId);
    if (!isRouteAllowedForPath(presetId, location.pathname)) {
      throw redirect({ to: homeRouteForPreset(presetId) ?? "/dashboard" });
    }
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { user } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const billing = useBilling();
  const expired = billing.data ? computeAccess(billing.data) === "expired" : false;
  const blocked = expired && pathname !== "/dashboard/billing";

  return (
    <DashboardShell email={user?.email ?? undefined}>
      {blocked ? (
        <div className="clay-panel mx-auto mt-10 max-w-lg space-y-4 p-8 text-center">
          <h2 className="text-xl font-semibold">{t("Bepul muddat tugadi")}</h2>
          <p className="text-muted-foreground">
            {t("Ma'lumotlaringiz saqlangan. CRMdan foydalanishni davom ettirish uchun tarifni tanlang.")}
          </p>
          <Button asChild>
            <Link to="/dashboard/billing">{t("Tarifni tanlash")}</Link>
          </Button>
        </div>
      ) : (
        <Outlet />
      )}
    </DashboardShell>
  );
}
