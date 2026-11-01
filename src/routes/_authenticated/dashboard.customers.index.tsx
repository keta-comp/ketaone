import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Plus } from "lucide-react";

import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/app/primitives";
import { CustomerDialog, usePickers } from "@/components/app/crm-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSectionVisibility } from "@/lib/section-visibility";
import { crmLabel, CUSTOMER_SOURCES, CUSTOMER_STATUSES } from "@/lib/crm-core";
import { listCrmCustomers } from "@/lib/customers.functions";
import { useSectionTitle, useTerminology } from "@/lib/terminology";
import { formatMoney } from "@/lib/types";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/dashboard/customers/")({
  head: () => ({
    meta: [
      { title: t("Mijozlar — KetaOne") },
      {
        name: "description",
        content: t("Mijozlar bazasi: aloqa ma’lumotlari, holati, manbasi va sotib olish tarixi."),
      },
      { property: "og:title", content: t("Mijozlar — KetaOne") },
      { property: "og:description", content: t("Har bir mijoz uchun to‘liq profil va tarix.") },
    ],
  }),
  component: CustomersPage,
});

type CustomerRow = Awaited<ReturnType<typeof listCrmCustomers>>[number];

function CustomersPage() {
  const fetchCustomers = useServerFn(listCrmCustomers);
  const pickers = usePickers(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [memberId, setMemberId] = useState("all");
  const [sort, setSort] = useState<"recent" | "name" | "spent">("recent");
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [open, setOpen] = useState(false);

  const { isHidden } = useSectionVisibility();
  const { term } = useTerminology();
  const person = term("customers");
  const query = useQuery({
    queryKey: ["crm-customers", search, status, source, memberId, sort],
    queryFn: () => fetchCustomers({ data: { search, status, source, memberId, sort } }),
  });

  useSectionTitle(person.many);

  const currency = "UZS";
  const showOrders = !isHidden("/dashboard/orders");

  return (
    <>
      <PageHeader
        title={person.many}
        description={t("Qidiruv, filtr va saralash bilan bazani boshqaring.")}
        actions={
          <Button
            size="sm"
            className="gap-1"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> {t("Yangi")}
          </Button>
        }
      />

      <div className="clay-panel flex flex-wrap items-center gap-2 p-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Ism, telefon yoki email…")}
          className="h-9 w-full sm:w-64"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder={t("Holat")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Barcha holat")}</SelectItem>
            {CUSTOMER_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {crmLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder={t("Manba")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Barcha manba")}</SelectItem>
            {CUSTOMER_SOURCES.map((value) => (
              <SelectItem key={value} value={value}>
                {crmLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={memberId} onValueChange={setMemberId}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder={t("Mas’ul")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Barcha mas’ul")}</SelectItem>
            {(pickers.data?.assignees ?? []).map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder={t("Saralash")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">{t("Oxirgi aloqa")}</SelectItem>
            <SelectItem value="name">{t("Ism bo‘yicha")}</SelectItem>
            <SelectItem value="spent">{t("Xarid summasi")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.isPending ? (
        <LoadingState label={t("{many} yuklanmoqda…", { many: person.many })} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          title={t("{many} topilmadi", { many: person.many })}
          description={t("Filtrni o‘zgartiring yoki yangi {term} qo‘shing.", { term: person.one })}
        />
      ) : (
        <>
        <div className="grid gap-2 sm:hidden">
          {(query.data ?? []).map((row) => {
            const assignee = row.assignee_name;
            return (
              <div key={row.id} className="clay-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    to="/dashboard/customers/$id"
                    params={{ id: row.id }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.full_name ?? "Ismsiz"}
                  </Link>
                  <StatusBadge value={row.status} />
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <p>{t("Aloqa")}: {[row.phone, row.email].filter(Boolean).join(" • ") || "—"}</p>
                  <p>{t("Manba")}: {crmLabel(row.source)}</p>
                  {showOrders ? (
                    <p>
                      {t("Buyurtma")}:{" "}
                      <Link
                        to="/dashboard/orders"
                        search={{ customerId: row.id }}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.total_orders}
                      </Link>
                      {" · "}
                      {t("Xarid")}: {formatMoney(row.total_spent, currency)}
                    </p>
                  ) : null}
                  <p>
                    {t("Mas’ul")}:{" "}
                    {assignee ? (
                      <Link to="/dashboard/team" className="underline-offset-4 hover:text-foreground hover:underline">
                        {assignee}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("Tahrirlash")}
                    onClick={() => {
                      setEditing(row);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="clay-panel hidden overflow-x-auto p-2 sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Ism")}</TableHead>
                <TableHead>{t("Aloqa")}</TableHead>
                <TableHead>{t("Holat")}</TableHead>
                <TableHead>{t("Manba")}</TableHead>
                {showOrders ? <TableHead>{t("Buyurtma")}</TableHead> : null}
                {showOrders ? <TableHead>{t("Xarid")}</TableHead> : null}
                <TableHead>{t("Mas’ul")}</TableHead>
                <TableHead className="text-right">{t("Amal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data ?? []).map((row) => {
                const assignee = row.assignee_name;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/dashboard/customers/$id"
                        params={{ id: row.id }}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.full_name ?? "Ismsiz"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[row.phone, row.email].filter(Boolean).join(" • ") || "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={row.status} />
                    </TableCell>
                    <TableCell className="text-xs">{crmLabel(row.source)}</TableCell>
                    {showOrders ? (
                      <TableCell className="tabular-nums">
                        <Link
                          to="/dashboard/orders"
                          search={{ customerId: row.id }}
                          className="underline-offset-4 hover:underline"
                        >
                          {row.total_orders}
                        </Link>
                      </TableCell>
                    ) : null}
                    {showOrders ? (
                      <TableCell className="tabular-nums">{formatMoney(row.total_spent, currency)}</TableCell>
                    ) : null}
                    <TableCell className="text-xs text-muted-foreground">
                      {assignee ? (
                        <Link to="/dashboard/team" className="underline-offset-4 hover:text-foreground hover:underline">
                          {assignee}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("Tahrirlash")}
                        onClick={() => {
                          setEditing(row);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      <CustomerDialog
        open={open}
        onOpenChange={setOpen}
        customer={
          editing
            ? {
                id: editing.id,
                full_name: editing.full_name,
                phone: editing.phone,
                email: editing.email,
                location: editing.location,
                status: editing.status,
                source: editing.source,
                assigned_member_id: editing.assigned_member_id,
                notes: editing.notes,
              }
            : undefined
        }
      />
    </>
  );
}
