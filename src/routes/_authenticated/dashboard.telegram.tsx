import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  confirmTelegramLink,
  getTelegramBotStatus,
  getTelegramLink,
  getTelegramLinkRequest,
  unlinkTelegram,
  updateTelegramSettings,
} from "@/lib/telegram-link.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

const searchSchema = z.object({ code: z.string().optional() });

export const Route = createFileRoute("/_authenticated/dashboard/telegram")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: t("Telegram integratsiyasi — KetaOne") },
      {
        name: "description",
        content: t("KetaOne hisobingizni Telegram bilan ulang va biznes hisobotlarini Telegram orqali oling."),
      },
      { property: "og:title", content: t("Telegram integratsiyasi — KetaOne") },
      { property: "og:description", content: t("Kunlik hisobot, Excel fayl va muhim bildirishnomalar Telegramda.") },
    ],
  }),
  component: TelegramPage,
});

function TelegramPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const fetchLink = useServerFn(getTelegramLink);
  const fetchRequest = useServerFn(getTelegramLinkRequest);
  const fetchBotStatus = useServerFn(getTelegramBotStatus);
  const confirm = useServerFn(confirmTelegramLink);
  const saveSettings = useServerFn(updateTelegramSettings);
  const unlink = useServerFn(unlinkTelegram);

  const link = useQuery({ queryKey: ["telegram-link"], queryFn: () => fetchLink() });
  const botStatus = useQuery({ queryKey: ["telegram-bot-status"], queryFn: () => fetchBotStatus() });
  const request = useQuery({
    queryKey: ["telegram-link-request", search.code],
    queryFn: () => fetchRequest({ data: { code: search.code! } }),
    enabled: Boolean(search.code),
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirm({ data: { code: search.code! } }),
    onSuccess: (result: { delivered?: boolean }) => {
      if (result?.delivered === false) {
        toast.warning(t("Ulanish saqlandi, lekin bot xabar yubora olmadi — administratorga murojaat qiling."));
      } else {
        toast.success(t("Telegram muvaffaqiyatli ulandi"));
      }
      void queryClient.invalidateQueries({ queryKey: ["telegram-link"] });
      void navigate({ to: "/dashboard/telegram", search: {} });
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Ulash amalga oshmadi"))),
  });

  const settingsMutation = useMutation({
    mutationFn: (input: Parameters<typeof saveSettings>[0] extends { data: infer D } ? D : never) =>
      saveSettings({ data: input }),
    onSuccess: () => {
      toast.success(t("Sozlamalar saqlandi"));
      void queryClient.invalidateQueries({ queryKey: ["telegram-link"] });
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Saqlash amalga oshmadi"))),
  });

  const unlinkMutation = useMutation({
    mutationFn: () => unlink(),
    onSuccess: () => {
      toast.success(t("Telegram uzildi"));
      void queryClient.invalidateQueries({ queryKey: ["telegram-link"] });
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Uzish amalga oshmadi"))),
  });

  if (link.isPending) return <LoadingState />;
  if (link.error) return <ErrorState error={link.error} onRetry={() => void link.refetch()} />;

  const current = link.data;

  return (
    <>
      <PageHeader
        title={t("Telegram integratsiyasi")}
        description={t("Telegram — hisobot va bildirishnoma kanali. Asosiy CRM ishi shu veb platformada davom etadi.")}
      />

      <BotHealthNotice status={botStatus.data} />

      {search.code ? (
        <div className="clay-panel space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t("Telegram akkauntini ulash")}</h2>
          {request.isPending ? (
            <p className="text-sm text-muted-foreground">{t("Tekshirilmoqda...")}</p>
          ) : request.data?.valid ? (
            <>
              <p className="text-sm text-muted-foreground">
                {request.data.username ? `@${request.data.username}` : t("Telegram akkauntingiz")} {t("ni KetaOne hisobingiz\n                bilan ulashga ruxsat berasizmi?")}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                  {confirmMutation.isPending ? t("Ulanmoqda...") : t("Ha, ruxsat beraman")}
                </Button>
                <Button variant="outline" onClick={() => void navigate({ to: "/dashboard/telegram", search: {} })}>
                  {t("Bekor qilish")}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("Ulanish havolasi yaroqsiz yoki muddati tugagan. Telegram botga qaytib")}{" "}
              <span className="font-medium">/start</span> {t("yuboring va yangi havolani oling.")}
            </p>
          )}
        </div>
      ) : null}

      {current ? (
        <LinkedCard
          key={current.id}
          link={current}
          saving={settingsMutation.isPending}
          onSave={(values) => settingsMutation.mutate(values as never)}
          onUnlink={() => {
            if (window.confirm(t("Telegramni uzishni tasdiqlaysizmi? Hisobotlar kelishi to‘xtaydi."))) {
              unlinkMutation.mutate();
            }
          }}
          unlinking={unlinkMutation.isPending}
        />
      ) : (
        <div className="clay-panel space-y-3 p-6">
          <h2 className="text-lg font-semibold">{t("⚪️ Ulanmagan")}</h2>
          {botStatus.data && !botStatus.data.configured ? (
            <p className="text-sm text-muted-foreground">
              {t("Telegram boti hozircha sozlanmagan — hisobotlar kelmaydi. Administratorga murojaat qiling.")}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t("Telegram botni oching va")} <span className="font-medium">/start</span>{" "}
                {t("yuboring — ikki kirish usuli bor:")}{" "}
                {botStatus.data?.username ? (
                  <a
                    href={`https://t.me/${botStatus.data.username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline"
                  >
                    @{botStatus.data.username}
                  </a>
                ) : null}
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  <span className="font-medium">{t("“🔑 Email va parol bilan kirish”")}</span> —{" "}
                  {t("hammasi bot ichida. Parol faqat tekshirishga ishlatiladi va tekshirilgach chatdagi xabar o‘chiriladi.")}
                </li>
                <li>
                  <span className="font-medium">{t("“🔗 Xavfsiz havola orqali”")}</span> —{" "}
                  {t("bot sizni shu sahifaga qaytaradi, parol Telegramga kirmaydi.")}
                </li>
              </ul>
              <p className="text-sm text-muted-foreground">
                {t("Botdan hisobotlar, bugungi qabullar ro‘yxati va yangi qabul qo‘shish — hammasi saytga kirmasdan ishlaydi.")}
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}

type LinkRow = NonNullable<Awaited<ReturnType<typeof getTelegramLink>>>;

type BotStatus = NonNullable<Awaited<ReturnType<typeof getTelegramBotStatus>>>;

/**
 * Sahifa hech qachon "hammasi tayyor" demaydi, agar Telegram bizning serverga
 * yurolmasa: sabab tushunarli til aytiladi, token yoki maxfiy so'z ko'rsatilmaydi.
 */
function BotHealthNotice({ status }: { status: BotStatus | undefined }) {
  if (!status || status.webhook === "ok") return null;

  const message =
    status.webhook === "not_configured"
      ? t("Telegram boti serverda sozlanmagan — hisobotlar va bildirishnomalar hozircha ishlamaydi. Administratorga murojaat qiling.")
      : status.webhook === "unreachable"
        ? t("Telegram serveriga bog'lanib bo'lmadi — bot holatini hozir tekshirib bo'lmaydi.")
        : status.webhook === "missing"
          ? t("Bot ishlaydi, lekin webhook o'rnatilmagan: Telegram xabarlar bizning serverga yetib bormaydi. Administrator telegram-setup skriptini ishga tushirishi kerak.")
          : t("Webhook boshqa manzilga qaratilgan — sayt ko'chgan bo'lsa, uni qayta o'rnatish kerak.");

  return (
    <div className="clay-panel flex items-start gap-3 border border-destructive/30 bg-destructive/5 p-4">
      <span className="clay-inset grid size-9 shrink-0 place-items-center text-lg">🟠</span>
      <div className="space-y-1">
        <p className="font-display text-sm font-semibold">{t("Telegram holati")}</p>
        <p className="text-xs text-muted-foreground">{message}</p>
        {status.lastError ? (
          <p className="text-[11px] text-muted-foreground">
            {t("Telegramning oxirgi xatosi")}: {status.lastError}
          </p>
        ) : null}
        {status.configured && status.username ? (
          <a
            href={`https://t.me/${status.username}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium underline"
          >
            @{status.username}
          </a>
        ) : null}
      </div>
    </div>
  );
}


function LinkedCard({
  link,
  onSave,
  saving,
  onUnlink,
  unlinking,
}: {
  link: LinkRow;
  onSave: (values: {
    dailyReports: boolean;
    reportTime: string;
    timezone: string;
    notifyNewOrder: boolean;
    notifyPayment: boolean;
    notifyLead: boolean;
    notifyLowStock: boolean;
    notifyBooking: boolean;
  }) => void;
  saving: boolean;
  onUnlink: () => void;
  unlinking: boolean;
}) {
  const [dailyReports, setDailyReports] = useState(link.daily_reports);
  const [reportTime, setReportTime] = useState(link.report_time);
  const [timezone, setTimezone] = useState(link.timezone);
  const [notifyNewOrder, setNotifyNewOrder] = useState(link.notify_new_order);
  const [notifyPayment, setNotifyPayment] = useState(link.notify_payment);
  const [notifyLead, setNotifyLead] = useState(link.notify_lead);
  const [notifyLowStock, setNotifyLowStock] = useState(link.notify_low_stock);
  const [notifyBooking, setNotifyBooking] = useState(link.notify_booking);

  useEffect(() => {
    setDailyReports(link.daily_reports);
    setReportTime(link.report_time);
    setTimezone(link.timezone);
  }, [link.daily_reports, link.report_time, link.timezone]);

  return (
    <div className="clay-panel space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("🟢 Ulangan")}</h2>
        <p className="text-sm text-muted-foreground">
          {link.telegram_username ? `@${link.telegram_username}` : t("Telegram akkaunt")} ·{" "}
          {new Date(link.linked_at).toLocaleDateString("uz-UZ")} {t("dan beri")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ToggleRow label={t("Kunlik hisobot")} value={dailyReports} onChange={setDailyReports} />
        <div className="space-y-2">
          <Label htmlFor="report-time">{t("Hisobot vaqti")}</Label>
          <Input id="report-time" type="time" value={reportTime} onChange={(e) => setReportTime(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">{t("Vaqt mintaqasi")}</Label>
          <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ToggleRow label={t("Yangi buyurtma bildirishnomasi")} value={notifyNewOrder} onChange={setNotifyNewOrder} />
        <ToggleRow label={t("To‘lov bildirishnomasi")} value={notifyPayment} onChange={setNotifyPayment} />
        <ToggleRow label={t("Muhim lead bildirishnomasi")} value={notifyLead} onChange={setNotifyLead} />
        <ToggleRow label={t("Ombor qoldig‘i bildirishnomasi")} value={notifyLowStock} onChange={setNotifyLowStock} />
        <ToggleRow label={t("Yangi bron bildirishnomasi")} value={notifyBooking} onChange={setNotifyBooking} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() =>
            onSave({
              dailyReports,
              reportTime: reportTime.slice(0, 5),
              timezone,
              notifyNewOrder,
              notifyPayment,
              notifyLead,
              notifyLowStock,
              notifyBooking,
            })
          }
          disabled={saving}
        >
          {saving ? t("Saqlanmoqda...") : t("Saqlash")}
        </Button>
        <Button variant="destructive" onClick={onUnlink} disabled={unlinking}>
          {unlinking ? t("Uzilmoqda...") : t("Telegramni uzish")}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="clay-inset flex items-center justify-between gap-4 rounded-2xl px-4 py-3">
      <span className="text-sm">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
