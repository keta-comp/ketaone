/**
 * Onlayn bron havolasi — slugh olish, nusxalash va yoqib/o'chirish.
 * Sozlamalar sahifasi va klublarning «Bron va qabul sozlamalari» sahifasi shu
 * bitta kartochkani ko'rsatadi, shuning uchun havola qoidasi ikki joyda ayrilmaydi.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getMyBookingLink, setMyBookingEnabled } from "@/lib/public-booking.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export function BookingLinkCard() {
  const queryClient = useQueryClient();
  const fetchLink = useServerFn(getMyBookingLink);
  const setEnabled = useServerFn(setMyBookingEnabled);

  const link = useQuery({ queryKey: ["booking-link"], queryFn: () => fetchLink() });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => setEnabled({ data: { enabled } }),
    onSuccess: () => {
      toast.success(t("Saqlandi"));
      void queryClient.invalidateQueries({ queryKey: ["booking-link"] });
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Saqlash amalga oshmadi"))),
  });

  if (link.isPending || !link.data) return null;

  const url = `${window.location.origin}/b/${link.data.slug}`;
  return (
    <section className="clay-panel space-y-3 p-5">
      <h2 className="font-display text-lg font-semibold">{t("Onlayn qabul havolasi")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("Mijozlaringiz ro'yxatdan o'tmasdan ushbu havola orqali yozilishi mumkin.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          readOnly
          value={url}
          className="min-w-64 flex-1 font-mono text-xs"
          onFocus={(event) => event.target.select()}
        />
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(url);
            toast.success(t("Havola nusxalandi"));
          }}
        >
          {t("Nusxalash")}
        </Button>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={link.data.enabled}
          onCheckedChange={(checked) => toggleMutation.mutate(checked)}
          disabled={toggleMutation.isPending}
        />
        <span>{t("Onlayn qabul yoqilgan")}</span>
      </label>
    </section>
  );
}
