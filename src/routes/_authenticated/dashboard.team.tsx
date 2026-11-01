import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { intlLocale, t } from "@/lib/i18n";
import { listBranches } from "@/lib/branches.functions";
import { getTeam, removeMember, setMemberBranch, setMemberRole } from "@/lib/members.functions";
import { ASSIGNABLE_ROLES, ROLE_LABELS, type MemberRole } from "@/lib/roles";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/team")({
  head: () => ({
    meta: [
      { title: t("Jamoa a'zolari — KetaOne") },
      { name: "description", content: t("Biznesingiz a'zolari va ularning rollarini boshqaring.") },
      { property: "og:title", content: t("Jamoa a'zolari — KetaOne") },
      { property: "og:description", content: t("Foydalanuvchilar, rollar va ruxsatlar.") },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const queryClient = useQueryClient();
  const fetchTeam = useServerFn(getTeam);
  const fetchBranches = useServerFn(listBranches);
  const changeRole = useServerFn(setMemberRole);
  const changeBranch = useServerFn(setMemberBranch);
  const remove = useServerFn(removeMember);

  const team = useQuery({ queryKey: ["team"], queryFn: () => fetchTeam() });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => fetchBranches({ data: {} }) });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["team"] });

  const roleMutation = useMutation({
    mutationFn: (input: { memberId: string; role: MemberRole }) => changeRole({ data: input }),
    onSuccess: () => {
      toast.success(t("Rol o'zgartirildi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const branchMutation = useMutation({
    mutationFn: (input: { memberId: string; branchId: string | null }) => changeBranch({ data: input }),
    onSuccess: () => {
      toast.success(t("Filial yangilandi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => remove({ data: { memberId } }),
    onSuccess: () => {
      toast.success(t("A'zo o'chirildi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const isAdmin = team.data?.isAdmin ?? false;
  const myRole = team.data?.myRole ?? null;
  const branchList = branches.data ?? [];
  const showBranchColumn = isAdmin && branchList.length > 0;

  return (
    <>
      <PageHeader
        title={t("Jamoa a'zolari")}
        description={t("Akkauntlar, rollar va ruxsatlar. Rol kim nima qila olishini belgilaydi.")}
      />

      {team.isPending ? (
        <LoadingState />
      ) : team.error ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t("A'zo")}</th>
                <th className="px-4 py-3">{t("Qo'shilgan")}</th>
                <th className="px-4 py-3">{t("Rol")}</th>
                {showBranchColumn ? <th className="px-4 py-3">{t("Filial")}</th> : null}
                {isAdmin ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {team.data.members.map((member) => {
                const roleOptions =
                  myRole === "owner" ? (["owner", ...ASSIGNABLE_ROLES] as MemberRole[]) : ASSIGNABLE_ROLES;
                const canEditRole =
                  isAdmin && !member.isSelf && (member.role !== "owner" || myRole === "owner");
                return (
                  <tr key={member.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {member.full_name ?? member.email ?? "—"}
                        {member.isSelf ? <span className="ml-2 text-xs text-muted-foreground">{t("(siz)")}</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{member.email ?? "—"}</p>
                      <Link
                        to="/dashboard/tasks"
                        search={{ memberId: member.id }}
                        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {t("Vazifalar")}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(member.created_at).toLocaleDateString(intlLocale())}
                    </td>
                    <td className="px-4 py-3">
                      {canEditRole ? (
                        <Select
                          value={member.role}
                          onValueChange={(value) =>
                            roleMutation.mutate({ memberId: member.id, role: value as MemberRole })
                          }
                          disabled={roleMutation.isPending}
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {t(ROLE_LABELS[role])}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-foreground">{t(ROLE_LABELS[member.role])}</span>
                      )}
                    </td>
                    {showBranchColumn ? (
                      <td className="px-4 py-3">
                        <Select
                          value={member.branch_id ?? "none"}
                          onValueChange={(value) =>
                            branchMutation.mutate({ memberId: member.id, branchId: value === "none" ? null : value })
                          }
                          disabled={branchMutation.isPending}
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("Filialsiz")}</SelectItem>
                            {branchList.map((branch) => (
                              <SelectItem key={branch.id} value={branch.id}>
                                {branch.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    ) : null}
                    {isAdmin ? (
                      <td className="px-4 py-3 text-right">
                        {isAdmin && !member.isSelf && (member.role !== "owner" || myRole === "owner") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("A'zoni o'chirish")}
                            onClick={() => removeMutation.mutate(member.id)}
                            disabled={removeMutation.isPending}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="clay-panel p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("Rollar nima qiladi?")}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t("Ega va admin: barcha ruxsatlar, jumladan sozlamalar va jamoa boshqaruvi.")}</li>
          <li>{t("Menejer: kunlik operatsiyalar, moliya va hisobotlar — jamoani boshqara olmaydi.")}</li>
          <li>{t("Qabul: uchrashuvlar va mijozlar bilan ishlash.")}</li>
          <li>{t("Kassir: savdo va to'lovlar.")}</li>
        </ul>
      </div>
    </>
  );
}
