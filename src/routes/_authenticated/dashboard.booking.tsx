/**
 * Klublarning 4-bo'limi — bron va qabul sozlamalari.
 *
 * Qurilma/stol ro'yxati `services` katalogida, bronnilar `appointments` jadvalida
 * qoladi: klubga xos bo'lim ularni bitta sahifaga yig'adi, chunki unda CRM menyusi
 * (Xizmatlar, Qabullar, Sozlamalar) umuman ochilmaydi.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";

import { BookingLinkCard } from "@/components/app/booking-link-card";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { CLUB_CATALOG_LABELS, ServicesCatalog } from "@/components/app/services-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { saveBusinessSettings, getSettings } from "@/lib/settings.functions";
import { useSectionVisibility } from "@/lib/section-visibility";
import { useSectionTitle } from "@/lib/terminology";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/booking")({
  head: () => ({
    meta: [
      { title: t("Bron va qabul sozlamalari — KetaOne") },
      {
        name: "description",
        content: t("Qurilmalar, ish vaqti, onlayn bron havolasi va bronlarni boshqarish."),
      },
      { property: "og:title", content: t("Bron va qabul sozlamalari — KetaOne") },
      {
        property: "og:description",
        content: t("Band va bo'sh joylar, bron narxi va davomiyligi."),
      },
    ],
  }),
  component: ClubBookingPage,
});

function WorkingHoursCard() {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getSettings);
  const save = useServerFn(saveBusinessSettings);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const [value, setValue] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof save>[0] extends { data: infer D } ? D : never) =>
      save({ data: input }),
    onSuccess: () => {
      toast.success(t("Biznes sozlamalari saqlandi"));
      setValue(null);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Saqlash amalga oshmadi"))),
  });

  if (settings.isPending) return <LoadingState />;
  if (settings.error || !settings.data?.business)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const business = settings.data.business;
  const hours = value ?? business.working_hours ?? "";
  const isAdmin = settings.data.isAdmin;

  return (
    <section className="clay-panel space-y-3 p-5">
      <h2 className="font-display text-lg font-semibold">{t("Ish vaqti")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("Klub ochiq bo'lgan soatlar — onlayn bron shu oraliqdan slot taklif qiladi.")}
      </p>
      {isAdmin ? (
        <div className="space-y-2">
          <Label htmlFor="club-working-hours">{t("Ish vaqti")}</Label>
          <Input
            id="club-working-hours"
            value={hours}
            placeholder="10:00 - 23:00"
            onChange={(event) => setValue(event.target.value)}
          />
          <Button
            onClick={() =>
              mutation.mutate({
                id: business.id,
                business_name: business.business_name,
                business_description: business.business_description ?? "",
                working_hours: hours,
                delivery_info: business.delivery_info ?? "",
                payment_methods: business.payment_methods ?? "",
                return_policy: business.return_policy ?? "",
                currency: business.currency ?? "UZS",
                staff_group_chat_id: business.staff_group_chat_id ?? null,
              } as never)
            }
            disabled={hours === business.working_hours || mutation.isPending}
          >
            {mutation.isPending ? t("Saqlanmoqda…") : t("Saqlash")}
          </Button>
        </div>
      ) : (
        <p className="font-medium">{hours || "—"}</p>
      )}
    </section>
  );
}

function AppointmentsCard() {
  return (
    <section className="clay-panel space-y-3 p-5">
      <h2 className="font-display text-lg font-semibold">{t("Bronlarni boshqarish")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("Band va bo'sh joylar shu yerda ko'rinadi: tasdiqlash, o'zgartirish yoki bekor qilish.")}
      </p>
      <Button asChild variant="outline">
        <Link to="/dashboard/appointments" className="gap-2">
          <CalendarDays className="size-4" />
          {t("Bronlar jadvali")}
        </Link>
      </Button>
    </section>
  );
}

function ClubBookingPage() {
  useSectionTitle(t("Bron va qabul sozlamalari"));
  const { loading, offers, homeRoute } = useSectionVisibility();

  // Bu sahifa faqat klub menyularida bor; boshqa soha uni URL orqali ham ochmaydi.
  if (!loading && !offers("/dashboard/booking")) return <Navigate to={homeRoute} replace />;

  return (
    <>
      <PageHeader
        title={t("Bron va qabul sozlamalari")}
        description={t(
          "Qurilmalar va stollar, ish vaqti hamda onlayn bron shu yerda boshqariladi.",
        )}
      />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <WorkingHoursCard />
        <AppointmentsCard />
      </div>
      <BookingLinkCard />
      <div className="mt-6">
        <h2 className="mb-1 font-display text-lg font-semibold">{t("Qurilmalar va stollar")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("Har bir qurilma yoki stol alohida yozuv: nomi, davomiyligi va bir soat narxi.")}
        </p>
        <ServicesCatalog labels={CLUB_CATALOG_LABELS} />
      </div>
    </>
  );
}
