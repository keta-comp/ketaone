/**
 * Klublarning 1-bo'limi — tashqi vaqt hisoblagichi dasturini tarqatish.
 *
 * KetaOne dasturning o'zini yozmaydi va sessiyani sanamaydi (brief §16): bu yerda
 * faqat sayt egasi sozlagan havola, versiya va o'rnatish yo'riqnomasi turadi.
 */

import { createFileRoute, Navigate } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/primitives";
import { ProgramReleasesPanel } from "@/components/app/program-releases";
import { t } from "@/lib/i18n";
import { useSectionVisibility } from "@/lib/section-visibility";
import { useSectionTitle } from "@/lib/terminology";

export const Route = createFileRoute("/_authenticated/dashboard/program")({
  head: () => ({
    meta: [
      { title: t("Dasturni yuklab olish — KetaOne") },
      { name: "description", content: t("Vaqt hisoblash dasturi, versiyasi va o'rnatish yo'riqnomasi.") },
      { property: "og:title", content: t("Dasturni yuklab olish — KetaOne") },
      { property: "og:description", content: t("Android, Windows va macOS uchun yuklab olish havolalari.") },
    ],
  }),
  component: ProgramPage,
});

function ProgramPage() {
  useSectionTitle(t("Dasturni yuklab olish"));
  const { loading, offers, homeRoute } = useSectionVisibility();

  // Sahifa faqat klub menyularida bor: boshqa soha URL'ni qo'lda yozib kira olmaydi.
  if (!loading && !offers("/dashboard/program")) return <Navigate to={homeRoute} replace />;

  return (
    <>
      <PageHeader
        title={t("Dasturni yuklab olish")}
        description={t("Klub vaqtlarini hisoblaydigan dastur shu yerdan o'rnatiladi.")}
      />
      {/* APK hozircha yagona real fayl — shu kartochka oldinda, desktop platformalar
          egasi `.exe`/`.dmg` joylaguncha «mavjud emas» deb qoladi. */}
      <ProgramReleasesPanel platforms={["android", "windows", "macos"]} />
    </>
  );
}
