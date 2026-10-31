import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { ErrorState, LoadingState, PageHeader, StatCard, StatusBadge } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjustStock, listInventoryMovements, listProducts } from "@/lib/catalog.functions";
import { useHiddenSection } from "@/lib/section-visibility";
import { stockState } from "@/lib/types";
import { intlLocale, t } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/dashboard/inventory")({
  head: () => ({
    meta: [
      { title: t("Ombor — KetaOne") },
      { name: "description", content: t("Haqiqiy zaxira darajalari, bandlar va to'liq harakatlar tarixi.") },
      { property: "og:title", content: t("Ombor — KetaOne") },
      { property: "og:description", content: t("AI orqali Telegram savdosi uchun jonli zaxira nazorati.") },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  const queryClient = useQueryClient();
  const fetchProducts = useServerFn(listProducts);
  const fetchMovements = useServerFn(listInventoryMovements);
  const adjust = useServerFn(adjustStock);
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const hidden = useHiddenSection("/dashboard/inventory");

  const products = useQuery({
    queryKey: ["products", "inventory"],
    queryFn: () => fetchProducts({ data: {} }),
    enabled: !hidden,
  });
  const movements = useQuery({ queryKey: ["movements"], queryFn: () => fetchMovements(), enabled: !hidden });

  const mutation = useMutation({
    mutationFn: (input: { id: string; change: number }) =>
      adjust({ data: { id: input.id, change: input.change, reason: "manual_adjustment" } }),
    onSuccess: () => {
      toast.success(t("Zaxira yangilandi"));
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : t("O'zgartirish amalga oshmadi")),
  });

  if (hidden) return <Navigate to="/dashboard" replace />;
  if (products.isPending) return <LoadingState />;
  if (products.error) return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;

  const rows = products.data;
  const lowStock = rows.filter(
    (p) => stockState(p.stock_quantity, p.reserved_quantity, p.low_stock_threshold) === "low_stock",
  ).length;
  const outOfStock = rows.filter(
    (p) => stockState(p.stock_quantity, p.reserved_quantity, p.low_stock_threshold) === "out_of_stock",
  ).length;
  const units = rows.reduce((sum, p) => sum + p.stock_quantity, 0);
  const reserved = rows.reduce((sum, p) => sum + p.reserved_quantity, 0);

  return (
    <>
      <PageHeader title={t("Ombor")} description={t("AI mijozga va'da berishdan oldin tekshiradigan zaxira.")} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("SKU'lar")} value={rows.length} />
        <StatCard label={t("Qo'ldagi birliklar")} value={units} />
        <StatCard label={t("Band qilingan")} value={reserved} tone="info" />
        <StatCard label={t("Kam / tugagan")} value={`${lowStock} / ${outOfStock}`} tone="warning" />
      </div>

      <div className="clay-panel clay-inset overflow-x-auto rounded-3xl p-2">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">{t("Mahsulot")}</th>
              <th className="px-4 py-3">{t("Qo'lda")}</th>
              <th className="px-4 py-3">{t("Band")}</th>
              <th className="px-4 py-3">{t("Mavjud")}</th>
              <th className="px-4 py-3">{t("Holat")}</th>
              <th className="px-4 py-3">{t("O'zgartirish")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((product) => (
              <tr key={product.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{product.sku}</p>
                </td>
                <td className="px-4 py-3 tabular-nums">{product.stock_quantity}</td>
                <td className="px-4 py-3 tabular-nums">{product.reserved_quantity}</td>
                <td className="px-4 py-3 tabular-nums">{product.stock_quantity - product.reserved_quantity}</td>
                <td className="px-4 py-3">
                  <StatusBadge
                    value={stockState(product.stock_quantity, product.reserved_quantity, product.low_stock_threshold)}
                  />
                </td>
                <td className="px-4 py-3">
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const change = Number(deltas[product.id] ?? 0);
                      if (!change) return;
                      mutation.mutate({ id: product.id, change });
                      setDeltas({ ...deltas, [product.id]: "" });
                    }}
                  >
                    <Input
                      className="w-24"
                      type="number"
                      placeholder="+/-"
                      aria-label={t("{v0} uchun zaxirani o'zgartirish", { v0: product.name })}
                      value={deltas[product.id] ?? ""}
                      onChange={(event) => setDeltas({ ...deltas, [product.id]: event.target.value })}
                    />
                    <Button size="sm" variant="outline" type="submit">
                      {t("Qo'llash")}
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="clay-panel rounded-3xl p-4">
        <h2 className="font-display text-base font-semibold">{t("Harakatlar tarixi")}</h2>
        <div className="clay-inset mt-3 divide-y divide-border rounded-2xl p-2 text-sm">
          {(movements.data ?? []).map((movement) => {
            const product = movement.products as { name: string; sku: string } | null;
            return (
              <div key={movement.id} className="flex items-center justify-between gap-3 py-2 px-2">
                <span className="truncate text-foreground">{product?.name ?? "Mahsulot"}</span>
                <span className="text-xs capitalize text-muted-foreground">
                  {movement.reason.replace(/_/g, " ")}
                </span>
                <span
                  className={movement.change > 0 ? "tabular-nums text-success" : "tabular-nums text-destructive"}
                >
                  {movement.change > 0 ? `+${movement.change}` : movement.change}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(movement.created_at).toLocaleString(intlLocale())}
                </span>
              </div>
            );
          })}
          {movements.data?.length ? null : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("Hozircha harakatlar qayd etilmagan.")}</p>
          )}
        </div>
      </section>
    </>
  );
}
