/**
 * Klublarning 2-bo'limi — mobil ilova havolalari.
 *
 * Ilova hali chiqmagan bo'lishi mumkin: bunday holatda havola bo'sh qoladi va sahifa
 * soxta «yuklab olish» tugmasi chizmaydi (brief §16.2, §17.2).
 */

import { createFileRoute, Navigate } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/primitives";
import { ProgramReleasesPanel } from "@/components/app/program-releases";
import { t } from "@/lib/i18n";
import { useSectionVisibility } from "@/lib/section-visibility";
import { useSectionTitle } from "@/lib/terminology";

export const Route = createFileRoute("/_authenticated/dashboard/mobile")({
  head: () => ({
    meta: [
      { title: t("Mobil dastur — KetaOne") },
      { name: "description", content: t("Android va iOS uchun mobil ilova havolalari.") },
      { property: "og:title", content: t("Mobil dastur — KetaOne") },
      { property: "og:description", content: t("Android va iOS uchun mobil ilova havolalari.") },
    ],
  }),
  component: MobilePage,
});

function MobilePage() {
  useSectionTitle(t("Mobil dastur"));
  const { loading, offers, homeRoute } = useSectionVisibility();

  if (!loading && !offers("/dashboard/mobile")) return <Navigate to={homeRoute} replace />;

  return (
    <>
      <PageHeader
        title={t("Mobil dastur")}
        description={t("Telefondan bron va klub holatini ko'rish uchun ilova havolalari.")}
      />
      <ProgramReleasesPanel platforms={["android", "ios"]} />
    </>
  );
}
