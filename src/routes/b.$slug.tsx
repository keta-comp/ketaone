import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Clock, Phone, Scissors } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { depositFor } from "@/lib/deposit";
import { createPublicBooking, getPublicBookingPage, getPublicSlots } from "@/lib/public-booking.functions";
import { intlLocale, t } from "@/lib/i18n";
import { formatMoney } from "@/lib/types";

export const Route = createFileRoute("/b/$slug")({
  head: () => ({
    meta: [
      { title: t("Onlayn qabul — KetaOne") },
      { name: "description", content: t("Xizmatni, sanani va vaqtni tanlab onlayn yoziling.") },
      { property: "og:title", content: t("Onlayn qabul") },
      { property: "og:description", content: t("Xizmatni, sanani va vaqtni tanlab onlayn yoziling.") },
    ],
  }),
  component: PublicBookingPage,
});

function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function maxDateIso(): string {
  const now = new Date();
  now.setDate(now.getDate() + 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function PublicBookingPage() {
  const { slug } = Route.useParams();
  const fetchPage = useServerFn(getPublicBookingPage);
  const fetchSlots = useServerFn(getPublicSlots);
  const book = useServerFn(createPublicBooking);

  const [serviceId, setServiceId] = useState("");
  const [employeeId, setEmployeeId] = useState("any");
  const [date, setDate] = useState(todayIso());
  const [slot, setSlot] = useState<{ starts_at: string; employee_id: string } | null>(null);
  const [form, setForm] = useState({ full_name: "", phone: "", note: "" });
  const [done, setDone] = useState<{ starts_at: string; ends_at: string; employee_name: string; deposit_amount: number } | null>(null);

  const page = useQuery({
    queryKey: ["public-booking", slug],
    queryFn: () => fetchPage({ data: { slug } }),
  });

  const activeServiceId = serviceId || (page.data?.services[0]?.id ?? "");
  const activeService = page.data?.services.find((service) => service.id === activeServiceId) ?? null;
  const activeDeposit = activeService ? depositFor(activeService, Number(activeService.price)) : 0;

  const slots = useQuery({
    queryKey: ["public-slots", slug, activeServiceId, employeeId, date],
    queryFn: () =>
      fetchSlots({
        data: {
          slug,
          serviceId: activeServiceId,
          date,
          ...(employeeId !== "any" ? { employeeId } : {}),
        },
      }),
    enabled: !!activeServiceId && !done,
  });

  const bookMutation = useMutation({
    mutationFn: () =>
      book({
        data: {
          slug,
          serviceId: activeServiceId,
          starts_at: slot?.starts_at ?? "",
          full_name: form.full_name,
          phone: form.phone,
          note: form.note || undefined,
          ...(employeeId !== "any" ? { employeeId } : {}),
        },
      }),
    onSuccess: (result) => {
      setDone(result);
      toast.success(t("Bron qabul qilindi"));
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("Amalga oshmadi"));
      setSlot(null);
      void slots.refetch();
    },
  });

  if (page.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">{t("Yuklanmoqda…")}</p>
      </div>
    );
  }

  if (page.error || !page.data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="clay-panel max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold">{t("Sahifa topilmadi")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {page.error instanceof Error ? page.error.message : t("Bu havola yoki onlayn qabul yopiq bo'lishi mumkin.")}
          </p>
        </div>
      </div>
    );
  }

  const { businessName, services, employees, phone, logoUrl, workingHours } = page.data;

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="clay-panel w-full max-w-md p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10">
            <CalendarClock className="size-6 text-emerald-600" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">{t("Bron qabul qilindi")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {businessName} —{" "}
            {new Date(done.starts_at).toLocaleString(intlLocale(), {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {done.employee_name ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("Usta")}: {done.employee_name}</p>
          ) : null}
          <p className="mt-4 text-sm text-muted-foreground">
            {t("Administrator siz bilan bog'lanib bronni tasdiqlaydi.")}
          </p>
          {done.deposit_amount > 0 ? (
            <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
              {t("Depozit: {sum}", { sum: formatMoney(done.deposit_amount) })}
            </p>
          ) : null}
          {phone ? (
            <a
              href={`tel:${phone.replace(/[^\d+]/g, "")}`}
              className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary"
            >
              <Phone className="size-4" />
              {phone}
            </a>
          ) : null}
          <Button
            className="mt-6 w-full"
            variant="outline"
            onClick={() => {
              setDone(null);
              setSlot(null);
              setForm({ full_name: "", phone: "", note: "" });
            }}
          >
            {t("Yangi bron yaratish")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-4 sm:py-8">
      <header className="text-center">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={t("{v0} logotipi", { v0: businessName })}
            className="mx-auto size-16 rounded-2xl object-contain"
          />
        ) : (
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <Scissors className="size-6 text-primary" />
          </div>
        )}
        <h1 className="mt-3 font-display text-2xl font-semibold">{businessName}</h1>
        <p className="text-sm text-muted-foreground">{t("Onlayn qabul — vaqtingizni tanlang")}</p>
        {phone ? (
          <a
            href={`tel:${phone.replace(/[^\d+]/g, "")}`}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary"
          >
            <Phone className="size-4" />
            {phone}
          </a>
        ) : null}
        {workingHours ? (
          <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            {workingHours}
          </p>
        ) : null}
      </header>

      <div className="clay-panel grid gap-3 p-4">
        <div>
          <Label htmlFor="pb-service">{t("Xizmat")}</Label>
          <Select value={activeServiceId} onValueChange={(value) => { setServiceId(value); setSlot(null); }}>
            <SelectTrigger id="pb-service">
              <SelectValue placeholder={t("Xizmatni tanlang")} />
            </SelectTrigger>
            <SelectContent>
              {services.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name} · {service.duration_minutes} {t("min")} · {formatMoney(Number(service.price))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {employees.length > 0 ? (
          <div>
            <Label htmlFor="pb-employee">{t("Xodim")}</Label>
            <Select
              value={employeeId}
              onValueChange={(value) => {
                setEmployeeId(value);
                setSlot(null);
              }}
            >
              <SelectTrigger id="pb-employee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("Birinchi bo'sh xodim")}</SelectItem>
                {employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.full_name}
                    {employee.position ? ` · ${employee.position}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div>
          <Label htmlFor="pb-date">{t("Sana")}</Label>
          <Input
            id="pb-date"
            type="date"
            min={todayIso()}
            max={maxDateIso()}
            value={date}
            onChange={(event) => {
              setDate(event.target.value || todayIso());
              setSlot(null);
            }}
          />
        </div>
      </div>

      <div className="clay-panel p-4">
        <p className="text-sm font-medium">{t("Bo'sh vaqtlar")}</p>
        {slots.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("Vaqtlar yuklanmoqda…")}</p>
        ) : slots.error ? (
          <p className="mt-2 text-sm text-destructive">
            {slots.error instanceof Error ? slots.error.message : t("Vaqtlarni yuklab bo'lmadi")}
          </p>
        ) : (slots.data?.slots.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("Bu kunga bo'sh vaqt yo'q — boshqa kunni tanlang.")}</p>
        ) : (
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
            {slots.data?.slots.map((option) => {
              const label = new Date(option.starts_at).toLocaleTimeString(intlLocale(), {
                hour: "2-digit",
                minute: "2-digit",
              });
              const showEmployee = employeeId === "any" && option.employee_name;
              const selected = slot?.starts_at === option.starts_at && slot?.employee_id === option.employee_id;
              return (
                <button
                  key={`${option.starts_at}-${option.employee_id}`}
                  type="button"
                  onClick={() => setSlot({ starts_at: option.starts_at, employee_id: option.employee_id })}
                  className={
                    selected
                      ? "rounded-xl bg-primary px-2 py-2 text-center text-sm font-medium text-primary-foreground"
                      : "rounded-xl bg-muted px-2 py-2 text-center text-sm hover:bg-muted/70"
                  }
                >
                  {label}
                  {showEmployee ? (
                    <span className="block truncate text-[10px] font-normal opacity-70">{option.employee_name}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <form
        className="clay-panel grid gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!slot) {
            toast.error(t("Avval vaqt tanlang"));
            return;
          }
          bookMutation.mutate();
        }}      >
        <div>
          <Label htmlFor="pb-name">{t("Ismingiz")}</Label>
          <Input
            id="pb-name"
            required
            minLength={2}
            value={form.full_name}
            onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="pb-phone">{t("Telefon")}</Label>
          <Input
            id="pb-phone"
            type="tel"
            required
            placeholder="+998 90 123 45 67"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="pb-note">{t("Izoh")}</Label>
          <Textarea
            id="pb-note"
            rows={2}
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </div>
        <Button type="submit" size="lg" disabled={bookMutation.isPending || !slot || !activeService}>
          {bookMutation.isPending ? t("Yuborilmoqda…") : t("Yozilish")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {activeService
            ? `${activeService.name} · ${activeService.duration_minutes} ${t("min")} · ${formatMoney(Number(activeService.price))}`
            : ""}
        </p>
        {activeDeposit > 0 ? (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-700">
            {t("Bron uchun depozit: {sum}", { sum: formatMoney(activeDeposit) })}
          </p>
        ) : null}
      </form>

      <footer className="pb-6 text-center text-xs text-muted-foreground">
        {t("KetaOne orqali onlayn qabul")}
      </footer>
    </div>
  );
}
