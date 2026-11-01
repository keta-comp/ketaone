import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DELETE_CONFIRM_KEY, isDeleteConfirmation } from "@/lib/delete-confirm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import {
  DataTable,
  Field,
  NoData,
  Panel,
  Pill,
  downloadBase64Xlsx,
  fmtDate,
  fmtNumber,
} from "@/components/app/super-admin-ui";
import {
  deletePlatformUser,
  exportPlatformExcel,
  getPlatformUser,
  listUsersFn,
  previewUserDeletion,
  setUserPassword,
  setUserRole,
  setUserStatus,
} from "@/lib/super-admin.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/super-admin/users")({
  head: () => ({
    meta: [
      { title: t("Foydalanuvchilar — KetaOne Control Center") },
      { name: "description", content: t("KetaOne platformasidagi barcha foydalanuvchilar, rollari va holati.") },
      { property: "og:title", content: t("Foydalanuvchilar — KetaOne Control Center") },
      { property: "og:description", content: t("Barcha foydalanuvchilar: organization, rol, holat, faollik.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsersPage,
});

const ROLES = ["owner", "admin", "manager", "receptionist", "cashier"] as const;

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (role: (typeof ROLES)[number]) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as (typeof ROLES)[number])} disabled={disabled}>
      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>{r}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function UserDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const load = useServerFn(getPlatformUser);
  const statusFn = useServerFn(setUserStatus);
  const roleFn = useServerFn(setUserRole);
  const passwordFn = useServerFn(setUserPassword);
  const previewFn = useServerFn(previewUserDeletion);
  const deleteFn = useServerFn(deletePlatformUser);
  const [newPassword, setNewPassword] = useState("");
  const [danger, setDanger] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  // Tasdiq so'zi interfeys tilida: inglizcha panelda "DELETE" so'raladi.
  const confirmWord = t(DELETE_CONFIRM_KEY);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["super-admin-user", userId],
    queryFn: () => load({ data: { id: userId } }),
  });

  // Raqamlar faqat "Butunlay o‘chirish" bosilganda so'raladi — oddiy profil
  // ko'rish uchun qo'shimcha so'rov ortmasligi kerak.
  const deletion = useQuery({
    queryKey: ["super-admin-user-deletion", userId],
    enabled: danger,
    queryFn: () => previewFn({ data: { id: userId } }),
  });

  const invalidate = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ["super-admin-users"] });
  };

  const changeStatus = useMutation({
    mutationFn: (status: "active" | "suspended") => statusFn({ data: { id: userId, status } }),
    onSuccess: (result) => {
      toast.success(
        result && result.sessionsCleared > 0
          ? t("Bloklandi — sessiyalar yopildi, endi kira olmaydi")
          : t("Holat yangilandi"),
      );
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, t("Amal bajarilmadi"))),
  });

  const changeRole = useMutation({
    mutationFn: (input: { businessId: string; role: (typeof ROLES)[number] }) =>
      roleFn({ data: { id: userId, businessId: input.businessId, role: input.role } }),
    onSuccess: () => {
      toast.success(t("Rol yangilandi"));
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, t("Amal bajarilmadi"))),
  });

  const setPassword = useMutation({
    mutationFn: (password: string) => passwordFn({ data: { id: userId, password } }),
    onSuccess: () => {
      toast.success(t("Parol almashtirildi — eski sessiyalar ishlashda davom etadi."));
      setNewPassword("");
    },
    onError: (e) => toast.error(friendlyError(e, t("Parol almashtirilmadi"))),
  });

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: userId, confirm: confirmText } }),
    onSuccess: (result) => {
      toast.success(
        t("Hisob o‘chirildi. {v0} ta biznes va {v1} ta a’zolik ham ketdi.", {
          v0: result?.businessesDeleted ?? 0,
          v1: result?.membershipsDeleted ?? 0,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ["super-admin-users"] });
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e, t("O‘chirilmadi"))),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Foydalanuvchi profili")}</DialogTitle>
          <DialogDescription>
            {t("Parol va maxfiy kalitlar hech qachon ko‘rsatilmaydi — faqat yangi parol belgilanadi.")}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data ? (
          <NoData />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Ism")} value={data.profile.name ?? "—"} />
              <Field label={t("Email")} value={data.profile.email ?? "—"} />
              <Field label={t("Telefon")} value={data.profile.phone ?? "—"} />
              <Field label={t("Holat")} value={<Pill value={data.profile.status} />} />
              <Field label={t("Ro‘yxatdan o‘tgan")} value={fmtDate(data.profile.createdAt)} />
              <Field label={t("Oxirgi faollik")} value={fmtDate(data.profile.lastActiveAt)} />
              <Field label={t("AI so‘rovlari")} value={fmtNumber(data.usage.aiRequests)} />
              <Field
                label={t("Platforma roli")}
                value={
                  data.profile.isSuperAdmin
                    ? t("Super Admin")
                    : data.memberships.length
                      ? t("Rollar organization bo‘yicha belgilanadi")
                      : t("Hech bir organization’ga a’zo emas")
                }
              />
            </div>

            {data.memberships.length ? (
              <DataTable columns={["Organization", "Rol", "Holat", "Plan"]}>
                {data.memberships.map((m) => (
                  <tr key={m.businessId}>
                    <td className="px-3 py-2">
                      <Link to="/super-admin/organizations/$id" params={{ id: m.businessId }} className="underline-offset-4 hover:underline">
                        {m.organization ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <RoleSelect
                        disabled={data.profile.isSuperAdmin || changeRole.isPending}
                        value={m.role}
                        onChange={(role) => changeRole.mutate({ businessId: m.businessId, role })}
                      />
                    </td>
                    <td className="px-3 py-2"><Pill value={m.organizationStatus} /></td>
                    <td className="px-3 py-2">{m.plan ?? "—"}</td>
                  </tr>
                ))}
              </DataTable>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {data.profile.status === "suspended" ? (
                <Button size="sm" onClick={() => changeStatus.mutate("active")}>{t("Qayta faollashtirish")}</Button>
              ) : (
                <Button size="sm" variant="destructive" disabled={data.profile.isSuperAdmin} onClick={() => changeStatus.mutate("suspended")}>
                  {t("Bloklash")}
                </Button>
              )}
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">{t("Parolni almashtirish")}</p>
              <p className="text-xs text-muted-foreground">
                {t("Email orqali tiklash sozlanmagan — administrator yangi parolni qo‘lda belgilaydi.")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  type="password"
                  className="max-w-64"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("Yangi parol (kamida 8 belgi)")}
                />
                <Button
                  size="sm"
                  disabled={newPassword.length < 8 || setPassword.isPending}
                  onClick={() => setPassword.mutate(newPassword)}
                >
                  <KeyRound className="size-4" /> {t("Saqlash")}
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
              {danger ? (
                deletion.isPending ? (
                  <LoadingState />
                ) : deletion.error ? (
                  <ErrorState error={deletion.error} onRetry={() => void deletion.refetch()} />
                ) : deletion.data ? (
                  <>
                    <p className="text-sm font-medium text-destructive">{t("Butunlay o‘chirish")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("O‘chirilsa sessiyalar, parol yozuvi va profil ketadi ({v0} ta a’zolik). U {v1} ta biznesning egasi bo‘lsa, har bir organizatsiyaning barcha maʼlumoti — mijozlar, bronlar, to‘lovlar, fayllar — qaytarib bo‘lmaslik darajasida yo‘qoladi.", {
                        v0: deletion.data.memberships,
                        v1: deletion.data.businessesOwned,
                      })}
                    </p>
                    <Input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={t("Tasdiq uchun {v0} deb yozing", { v0: confirmWord })}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!isDeleteConfirmation(confirmText) || remove.isPending}
                        onClick={() => remove.mutate()}
                      >
                        {t("Ha, o‘chirilsin")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDanger(false)}>
                        {t("Bekor qilish")}
                      </Button>
                    </div>
                  </>
                ) : null
              ) : (
                <>
                  <p className="text-sm font-medium">{t("Xavfli hudud")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("O‘chirish qaytarilmaydi. Foydalanuvchini vaqtincha to‘xtatish uchun “Bloklash” yetarli.")}
                  </p>
                  <Button size="sm" variant="destructive" onClick={() => setDanger(true)}>
                    {t("Butunlay o‘chirish")}
                  </Button>
                </>
              )}
            </div>

            {data.audit.length ? (
              <DataTable columns={["Vaqt", "Amal", "Holat", "IP"]}>
                {data.audit.map((a, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-xs">{fmtDate(a.created_at)}</td>
                    <td className="px-3 py-2">{a.action}</td>
                    <td className="px-3 py-2"><Pill value={a.status} /></td>
                    <td className="px-3 py-2 text-xs">{a.ip ?? "—"}</td>
                  </tr>
                ))}
              </DataTable>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UsersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useServerFn(listUsersFn);
  const exportFn = useServerFn(exportPlatformExcel);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["super-admin-users", search, status, role],
    queryFn: () => load({ data: { search, status, role } }),
  });

  const exportExcel = async () => {
    try {
      const file = await exportFn({ data: { kind: "users" } });
      downloadBase64Xlsx(file.base64, file.filename);
    } catch (e) {
      toast.error(friendlyError(e, t("Eksport qilinmadi")));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Foydalanuvchilar")}
        description={t("Platformadagi barcha hisoblar. Parol va maxfiy kalitlar ko‘rsatilmaydi.")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void exportExcel()}>
            <Download className="size-4" /> Excel
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Ism, email, organization")} />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder={t("Holat")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha holatlar")}</SelectItem>
              <SelectItem value="active">{t("Faol")}</SelectItem>
              <SelectItem value="suspended">{t("Bloklangan")}</SelectItem>
              <SelectItem value="pending">{t("Kutilmoqda")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger><SelectValue placeholder={t("Rol")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha rollar")}</SelectItem>
              <SelectItem value="super_admin">{t("Super Admin")}</SelectItem>
              {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Panel>

      <Panel>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <NoData label={t("Foydalanuvchi topilmadi")} />
        ) : (
          <DataTable columns={["Ism", "Email", "Organization", "Rol", "Soha", "Holat", "Yaratilgan", "Oxirgi faollik"]}>
            {(data ?? []).map((u) => (
              <tr key={u.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(u.id)}>
                <td className="px-3 py-2 font-medium">{u.name ?? "—"}</td>
                <td className="px-3 py-2">{u.email ?? "—"}</td>
                <td className="px-3 py-2">{u.organization ?? "—"}</td>
                <td className="px-3 py-2">{u.role === "super_admin" ? t("Super Admin") : u.role}</td>
                <td className="px-3 py-2">{u.industry ?? "—"}</td>
                <td className="px-3 py-2"><Pill value={u.status} /></td>
                <td className="px-3 py-2 text-xs">{fmtDate(u.createdAt)}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(u.lastActiveAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {selected ? <UserDialog userId={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
