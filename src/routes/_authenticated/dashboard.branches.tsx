import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { deleteBranch, listBranches, saveBranch } from "@/lib/branches.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/branches")({
  head: () => ({
    meta: [
      { title: t("Filiallar — KetaOne") },
      { name: "description", content: t("Biznes filiallarini qo'shing va boshqaring.") },
      { property: "og:title", content: t("Filiallar — KetaOne") },
      { property: "og:description", content: t("Ko'p filialli bizneslar uchun boshqaruv.") },
    ],
  }),
  component: BranchesPage,
});

function BranchesPage() {
  const queryClient = useQueryClient();
  const fetchBranches = useServerFn(listBranches);
  const save = useServerFn(saveBranch);
  const remove = useServerFn(deleteBranch);

  const [form, setForm] = useState({ name: "", address: "", phone: "" });

  const branches = useQuery({
    queryKey: ["branches", "all"],
    queryFn: () => fetchBranches({ data: { includeInactive: true } }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["branches"] });
    void queryClient.invalidateQueries({ queryKey: ["team"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => save({ data: { name: form.name, address: form.address, phone: form.phone } }),
    onSuccess: () => {
      toast.success(t("Filial qo'shildi"));
      setForm({ name: "", address: "", phone: "" });
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const toggleMutation = useMutation({
    mutationFn: (input: {
      id: string;
      name: string;
      address: string;
      phone: string;
      is_active: boolean;
    }) => save({ data: input }),
    onSuccess: () => invalidate(),
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t("Filial o'chirildi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  return (
    <>
      <PageHeader title={t("Filiallar")} description={t("Ko'p filialli bizneslar uchun manzil va aloqa ma'lumotlari.")} />

      <form
        className="clay-panel grid gap-3 p-4 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="sm:col-span-2">
          <Label htmlFor="branch-name">{t("Filial nomi")}</Label>
          <Input
            id="branch-name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="branch-address">{t("Manzil")}</Label>
          <Input
            id="branch-address"
            value={form.address}
            onChange={(event) => setForm({ ...form, address: event.target.value })}
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="branch-phone">{t("Telefon")}</Label>
            <Input
              id="branch-phone"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </div>
          <Button type="submit" className="mt-6" disabled={saveMutation.isPending}>
            {t("Qo'shish")}
          </Button>
        </div>
      </form>

      {branches.isPending ? (
        <LoadingState />
      ) : branches.error ? (
        <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />
      ) : (branches.data ?? []).length === 0 ? (
        <EmptyState title={t("Filiallar yo'q")} description={t("Yuqoridagi formadan birinchi filialni qo'shing.")} />
      ) : (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t("Filial nomi")}</th>
                <th className="px-4 py-3">{t("Manzil")}</th>
                <th className="px-4 py-3">{t("Telefon")}</th>
                <th className="px-4 py-3">{t("Faol")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(branches.data ?? []).map((branch) => (
                <tr key={branch.id}>
                  <td className="px-4 py-3 font-medium">{branch.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{branch.address || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{branch.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={branch.is_active}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({
                          id: branch.id,
                          name: branch.name,
                          address: branch.address,
                          phone: branch.phone,
                          is_active: checked,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("Filialni o'chirish")}
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(branch.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
