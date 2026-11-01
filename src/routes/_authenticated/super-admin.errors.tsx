import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eraser, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { DataTable, NoData, Panel, Pill, fmtDate } from "@/components/app/super-admin-ui";
import { clearErrorEventsFn, listErrorEventsFn } from "@/lib/super-admin.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/super-admin/errors")({
  head: () => ({
    meta: [
      { title: t("Xatolar jurnali — KetaOne Control Center") },
      {
        name: "description",
        content: t("Server tomonida yuzaga kelgan xatolar: yo‘l, xabar va tafsilotlari bilan."),
      },
      { property: "og:title", content: t("Xatolar jurnali — KetaOne Control Center") },
      { property: "og:description", content: t("Pilot va production muhitidagi xatolar monitoringi.") },
    ],
  }),
  component: ErrorsPage,
});

const HOUR_CHOICES = [1, 6, 24, 72, 168];

function ErrorsPage() {
  const [hours, setHours] = useState(24);
  const [routeFilter, setRouteFilter] = useState("all");
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  const load = useServerFn(listErrorEventsFn);
  const clear = useServerFn(clearErrorEventsFn);

  const query = useQuery({
    queryKey: ["super-admin-errors", hours, routeFilter],
    queryFn: () => load({ data: { hours, route: routeFilter } }),
  });

  const runClear = async (payload: { fingerprint?: string; olderThanDays?: number }) => {
    try {
      const result = await clear({ data: payload });
      toast.success(t("{v0} yozuv o'chirildi", { v0: result.deleted }));
      void query.refetch();
    } catch (error) {
      toast.error(friendlyError(error, t("Xatolik")));
    }
  };

  const rows = query.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Xatolar jurnali")}
        description={t("Bir xil xato 10 daqiqa ichida bir marta yoziladi.")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => {
              if (!window.confirm(t("7 kundandan eski xatolar o'chirilsinmi?"))) return;
              void runClear({ olderThanDays: 7 });
            }}
          >
            <Eraser className="size-4" /> {t("Eskilarini tozalash")}
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <Select value={String(hours)} onValueChange={(value) => setHours(Number(value))}>
            <SelectTrigger>
              <SelectValue placeholder={t("Oraliq")} />
            </SelectTrigger>
            <SelectContent>
              {HOUR_CHOICES.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {t("Oxirgi {v0} soat", { v0: choice })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={routeFilter} onValueChange={setRouteFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("Yo‘l")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha yo‘llar")}</SelectItem>
              {(query.data?.routes ?? []).map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Panel>

      <Panel>
        {query.isPending ? (
          <LoadingState />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <NoData label={t("Xatolar yo‘q — yaxshi belgi.")} />
        ) : (
          <DataTable columns={["Vaqt", "Yo‘l", "Xabar", "Holat", "Biznes", ""]}>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-xs">{fmtDate(row.created_at)}</td>
                <td className="px-3 py-2 text-xs">{row.route || "—"}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-left text-xs font-medium hover:underline"
                    onClick={() => setOpenDetail(openDetail === row.id ? null : row.id)}
                  >
                    {row.message}
                  </button>
                  {openDetail === row.id ? (
                    <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-2 text-[11px]">
                      {row.detail || t("Tafsilot yo‘q")}
                    </pre>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <Pill value={row.status_code ? String(row.status_code) : row.level} />
                </td>
                <td className="px-3 py-2 text-xs">{row.business_id ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("O‘chirish")}
                    onClick={() => void runClear({ fingerprint: row.fingerprint })}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
