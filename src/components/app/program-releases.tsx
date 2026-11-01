/**
 * Klublar uchun dastur tarqatish paneli — «Dasturni yuklab olish» va «Mobil dastur»
 * sahifalari bitta `program_releases` jadvalidan, faqat o'z platformalari bilan o'ladi.
 *
 * Havola bo'sh = dastur hali yo'q: tugma chizilmaydi, soxta «tez orada» ham ko'rsatilmaydi.
 * Yozish faqat egasi/admin (serverda `settings.manage` va RLS admin siyosati).
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { ErrorState, LoadingState } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getProgramReleases,
  saveProgramRelease,
  type ProgramRelease,
  type ReleasePlatform,
} from "@/lib/distribution.functions";
import { t } from "@/lib/i18n";

const PLATFORM_NAMES: Record<ReleasePlatform, string> = {
  windows: "Windows",
  macos: "macOS",
  android: "Android",
  ios: "iOS",
};

/**
 * `inputValidator` rad etgan input xatosi serverdan zod maslahatlar ro'yxati sifatida
 * (JSON satr) keladi — admin buni emas, bitta tushunarli gapni ko'rishi kerak.
 */
function releaseErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  try {
    const issues: unknown = JSON.parse(raw);
    if (Array.isArray(issues)) {
      const first = issues.find((issue) => typeof issue?.["message"] === "string");
      if (first) return String(first["message"]);
    }
  } catch {
    // JSON emas — xato matnini o'zini ko'rsatamiz.
  }
  return raw || t("Saqlash amalga oshmadi");
}

function lastUpdated(value: string | null): string {
  if (!value) return t("Hali yangilanmagan");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("Hali yangilanmagan");
  // Chrome `uz` ma'lumotida oy nomi «M11» bo'lib chiqadi — raqamli format hamma brauzerda bir xil.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function ReleaseCard({ release, isAdmin }: { release: ProgramRelease; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const save = useServerFn(saveProgramRelease);
  const [draft, setDraft] = useState({
    url: release.url,
    version: release.version,
    instructions: release.instructions,
  });

  const mutation = useMutation({
    mutationFn: () => save({ data: { platform: release.platform, ...draft } }),
    onSuccess: (result) => {
      toast.success(t("Saqlandi"));
      queryClient.setQueryData(["program-releases"], { releases: result.releases, isAdmin });
    },
    onError: (error: unknown) => toast.error(releaseErrorText(error)),
  });

  const dirty =
    draft.url !== release.url ||
    draft.version !== release.version ||
    draft.instructions !== release.instructions;

  return (
    <section className="clay-panel space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">{PLATFORM_NAMES[release.platform]}</h2>
        <p className="text-xs text-muted-foreground">
          {release.version ? `${t("Versiya")}: ${release.version} · ` : ""}
          {lastUpdated(release.updated_at)}
        </p>
      </div>

      {release.url ? (
        <Button asChild>
          <a href={release.url} target="_blank" rel="noreferrer" className="gap-2">
            <Download className="size-4" />
            {t("Yuklab olish")}
          </a>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("Bu platforma uchun dastur hali mavjud emas.")}
        </p>
      )}

      {release.instructions ? (
        <div className="clay-inset whitespace-pre-line rounded-2xl p-4 text-sm">
          {release.instructions}
        </div>
      ) : null}

      {isAdmin ? (
        <div className="space-y-3 border-t border-border/60 pt-4">
          <div className="space-y-1">
            <Label htmlFor={`url-${release.platform}`}>{t("Yuklab olish havolasi")}</Label>
            <Input
              id={`url-${release.platform}`}
              value={draft.url}
              placeholder="https://…"
              onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`version-${release.platform}`}>{t("Versiya")}</Label>
            <Input
              id={`version-${release.platform}`}
              value={draft.version}
              placeholder="1.0.0"
              onChange={(event) =>
                setDraft((current) => ({ ...current, version: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`instructions-${release.platform}`}>
              {t("O'rnatish yo'riqnomasi")}
            </Label>
            <Textarea
              id={`instructions-${release.platform}`}
              rows={3}
              value={draft.instructions}
              onChange={(event) =>
                setDraft((current) => ({ ...current, instructions: event.target.value }))
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Havola bo'sh qoldirilsa — dastur bu platformada yo'q deb ko'rsatiladi.")}
          </p>
          <Button onClick={() => mutation.mutate()} disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? t("Saqlanmoqda…") : t("Saqlash")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function ProgramReleasesPanel({ platforms }: { platforms: ReleasePlatform[] }) {
  const fetchReleases = useServerFn(getProgramReleases);
  const releases = useQuery({ queryKey: ["program-releases"], queryFn: () => fetchReleases() });

  if (releases.isPending) return <LoadingState label={t("Yuklanmoqda…")} />;
  if (releases.error || !releases.data)
    return <ErrorState error={releases.error} onRetry={() => void releases.refetch()} />;

  const { isAdmin, releases: rows } = releases.data;
  const wanted = new Set(platforms);
  const shown = rows.filter((release) => wanted.has(release.platform));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {shown.map((release) => (
        <ReleaseCard key={release.platform} release={release} isAdmin={isAdmin} />
      ))}
    </div>
  );
}
