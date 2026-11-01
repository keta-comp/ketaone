import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LIVE_REFETCH_MS } from "@/lib/polling";
import { listAssignees } from "@/lib/members.functions";
import { listOrders, updateOrder } from "@/lib/orders.functions";
import { useHiddenSection } from "@/lib/section-visibility";
import { useSectionTitle, useTerminology } from "@/lib/terminology";
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  formatMoney,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/types";
import { intlLocale, t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Yangi",
  confirming: "Tasdiqlanmoqda",
  confirmed: "Tasdiqlangan",
  preparing: "Tayyorlanmoqda",
  delivered: "Yetkazildi",
  cancelled: "Bekor qilindi",
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "To'lanmagan",
  partial: "Qisman to'langan",
  paid: "To'langan",
  refunded: "Qaytarilgan",
};

const searchSchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  customerId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/dashboard/orders")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: t("Buyurtmalar — KetaOne") },
      { name: "description", content: t("AI agenti Telegramda yakunlagan buyurtmalarni kuzating va bajaring.") },
      { property: "og:title", content: t("Buyurtmalar — KetaOne") },
      { property: "og:description", content: t("Avtomatik ombor zaxirasi bilan buyurtmalarni bajarish.") },
    ],
  }),
  component: OrdersPage,
});

type OrderPatch = {
  id: string;
  status?: OrderStatus;
  payment_status?: PaymentStatus;
  assigned_member_id?: string | null;
};

function OrdersPage() {
  const params = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchOrders = useServerFn(listOrders);
  const fetchAssignees = useServerFn(listAssignees);
  const save = useServerFn(updateOrder);
  const hidden = useHiddenSection("/dashboard/orders");
  const { term } = useTerminology();
  const ordersTerm = term("orders");
  useSectionTitle(ordersTerm.many);

  const status = params.status ?? "all";
  const search = params.search ?? "";
  const customerId = params.customerId ?? null;

  const setStatus = (next: string) =>
    void navigate({
      to: "/dashboard/orders",
      search: (prev) => ({ ...prev, status: next === "all" ? undefined : next }),
    });
  const setSearch = (next: string) =>
    void navigate({
      to: "/dashboard/orders",
      search: (prev) => ({ ...prev, search: next === "" ? undefined : next }),
    });

  const orders = useQuery({
    queryKey: ["orders", status, search, customerId],
    queryFn: () =>
      fetchOrders({ data: { status, search, ...(customerId ? { customerId } : {}) } }),
    refetchInterval: LIVE_REFETCH_MS,
    enabled: !hidden,
  });
  const assignees = useQuery({ queryKey: ["assignees"], queryFn: () => fetchAssignees() });

  const mutation = useMutation({
    mutationFn: (input: OrderPatch) => save({ data: input }),
    onSuccess: () => {
      toast.success(t("{term} yangilandi", { term: ordersTerm.one }));
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Yangilash amalga oshmadi"))),
  });

  if (hidden) return <Navigate to="/dashboard" replace />;

  return (
    <>
      <PageHeader
        title={ordersTerm.many}
        description={t("Buyurtmani tasdiqlash ombordan zaxiralaydi; bekor qilish uni bo'shatadi — bu ma'lumotlar bazasida avtomatik amalga oshadi.")}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor="order-search">{t("Buyurtma raqamini qidirish")}</Label>
          <Input
            id="order-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("ORD-")}
          />
        </div>
        <div className="w-44">
          <Label>{t("Holat")}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha holatlar")}</SelectItem>
              {ORDER_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(ORDER_STATUS_LABELS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {customerId ? (
          <button
            type="button"
            onClick={() =>
              void navigate({
                to: "/dashboard/orders",
                search: (prev) => ({ ...prev, customerId: undefined }),
              })
            }
            className="clay-inset h-9 rounded-xl px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {t("Mijoz bo‘yicha filtr")} ✕
          </button>
        ) : null}
      </div>

      {orders.isPending ? (
        <LoadingState />
      ) : orders.error ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : orders.data.length === 0 ? (
        <EmptyState title={t("Hali buyurtmalar yo'q")} description={t("AI agenti yoki jamoa a'zosi savdoni yakunlaganda buyurtmalar shu yerda paydo bo'ladi.")} />
      ) : (
        <div className="space-y-4">
          {orders.data.map((order) => {
            const customer = order.customers as {
              id: string | null;
              full_name: string | null;
              telegram_username: string | null;
            } | null;
            const customerName = customer?.full_name ?? customer?.telegram_username ?? "Telegram mijozi";
            const items = (order.order_items ?? []) as {
              id: string;
              product_name: string;
              quantity: number;
              line_total: number;
            }[];
            return (
              <div key={order.id} className="clay-panel clay-hover p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-display text-base font-semibold text-foreground">{order.order_number}</p>
                      <StatusBadge value={order.status} />
                      <StatusBadge value={order.payment_status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {customer?.id ? (
                        <Link
                          to="/dashboard/customers/$id"
                          params={{ id: customer.id }}
                          className="underline-offset-4 hover:underline"
                        >
                          {customerName}
                        </Link>
                      ) : (
                        customerName
                      )}{" "}
                      · {order.phone ?? "telefon yo'q"} · {new Date(order.created_at).toLocaleString(intlLocale())}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {order.assignee_name ? (
                        <>
                          {`${t("Mas’ul")}: `}
                          <Link
                            to="/dashboard/team"
                            className="text-foreground underline-offset-4 hover:underline"
                          >
                            {order.assignee_name}
                          </Link>
                        </>
                      ) : (
                        t("Biriktirilmagan")
                      )}
                      {order.order_number ? (
                        <>
                          {" · "}
                          <Link
                            to="/dashboard/payments"
                            search={{ search: order.order_number }}
                            className="underline-offset-4 hover:underline"
                          >
                            {t("To‘lovlar")}
                          </Link>
                        </>
                      ) : null}
                      {order.customer_id ? (
                        <>
                          {" · "}
                          <Link
                            to="/dashboard/tasks"
                            search={{ customerId: order.customer_id }}
                            className="underline-offset-4 hover:underline"
                          >
                            {t("Vazifalar")}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    {order.delivery_address ? (
                      <p className="text-sm text-muted-foreground">{t("Yetkazib berish manzili:")}{" "}{order.delivery_address}</p>
                    ) : null}
                  </div>
                  <p className="font-display text-lg font-semibold tabular-nums text-success">
                    {formatMoney(order.total)}
                  </p>
                </div>

                <ul className="clay-inset mt-3 space-y-1 rounded-xl p-3 text-sm">
                  {items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-2 text-muted-foreground">
                      <span>
                        {item.product_name} × {item.quantity}
                      </span>
                      <span className="tabular-nums">{formatMoney(item.line_total)}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label>{t("Buyurtma holati")}</Label>
                    <Select
                      value={order.status}
                      onValueChange={(value) => mutation.mutate({ id: order.id, status: value as OrderStatus })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_STATUSES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(ORDER_STATUS_LABELS[value])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("To'lov")}</Label>
                    <Select
                      value={order.payment_status}
                      onValueChange={(value) =>
                        mutation.mutate({ id: order.id, payment_status: value as PaymentStatus })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_STATUSES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(PAYMENT_STATUS_LABELS[value])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("Mas’ul")}</Label>
                    <Select
                      value={order.assigned_member_id ?? "none"}
                      onValueChange={(value) =>
                        mutation.mutate({
                          id: order.id,
                          assigned_member_id: value === "none" ? null : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("Biriktirilmagan")}</SelectItem>
                        {(assignees.data ?? []).map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
