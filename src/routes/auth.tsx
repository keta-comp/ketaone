import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { BrandMark, CONTACT_EMAIL, CONTACT_EMAIL_HREF } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyPasswordReset, getAuthSession, signIn, signUp } from "@/lib/auth.functions";
import { recordFailedLogin, recordLogin, recordRegistration } from "@/lib/session.functions";
import { t } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/app/LanguageSwitcher";
import { friendlyError } from "@/lib/friendly-error";

const TITLE = "Kabinaga kirish — KetaOne";
const DESCRIPTION =
  "KetaOne kabinasiga kiring yoki bepul ro‘yxatdan o‘tib biznesingiz uchun CRM tizimini sozlang.";

export type AuthSearch = {
  mode: "login" | "register" | "recover";
  redirect?: string | undefined;
  // Parolni tiklash havolasi tokenni shu parametrda qaytaradi.
  token?: string | undefined;
};

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AuthSearch => {
    const raw = search["mode"];
    const result: AuthSearch = {
      mode: raw === "register" || raw === "recover" ? raw : "login",
    };
    const redirect = search["redirect"];
    if (typeof redirect === "string" && redirect.startsWith("/")) result.redirect = redirect;
    const token = search["token"];
    if (typeof token === "string" && token) result.token = token;
    return result;
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { mode: initialMode, redirect: redirectTo, token: resetToken } = Route.useSearch();
  const adminOnly = (redirectTo ?? "").startsWith("/super-admin");
  const [mode, setMode] = useState<"login" | "register" | "recover">(
    resetToken ? "recover" : adminOnly ? "login" : initialMode,
  );
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resetToken) return;
    void getAuthSession()
      .then((session) => {
        if (session) void navigate({ to: redirectTo ?? "/dashboard" });
      })
      .catch(() => undefined);
  }, [navigate, redirectTo, resetToken]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "recover") {
        if (!resetToken) {
          throw new Error(
            t("Tiklash havolasi topilmadi. Email orqali tiklash sozlanmagan — administrator bilan bog‘laning."),
          );
        }
        if (password !== confirmPassword) throw new Error(t("Parollar mos kelmadi"));
        await applyPasswordReset({ data: { token: resetToken, password } });
        toast.success(t("Parol yangilandi. Endi yangi parol bilan kiring."));
        setPassword("");
        setConfirmPassword("");
        setMode("login");
        void navigate({ to: "/auth", search: { mode: "login" } });
        return;
      }
      if (mode === "register") {
        await signUp({
          data: {
            email,
            password,
            fullName: fullName.trim(),
            businessName: businessName.trim() || undefined,
          },
        });
        void recordRegistration().catch(() => undefined);
        navigate({ to: redirectTo ?? "/dashboard" });
        return;
      }
      try {
        await signIn({ data: { email, password } });
      } catch (error) {
        void recordFailedLogin({ data: { email } }).catch(() => undefined);
        throw error;
      }
      void recordLogin().catch(() => undefined);
      navigate({ to: redirectTo ?? "/dashboard" });
    } catch (error) {
      toast.error(friendlyError(error, t("Kirishda xatolik yuz berdi")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-6 flex justify-end">
        <LanguageSwitcher showLabel />
      </div>
      <Link to="/" className="mb-8">
        <BrandMark />
      </Link>

      <div className="clay-panel w-full max-w-md p-6 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {mode === "recover"
            ? t("Parolni tiklash")
            : adminOnly
              ? t("Boshqaruv markaziga kirish")
              : mode === "login"
                ? "Kabinaga kirish"
                : "Bepul boshlash"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "recover"
            ? t("Yangi parol kiriting — eski parol ishlamaydi.")
            : adminOnly
              ? t("Bu bo‘lim faqat platforma administratorlari uchun.")
              : mode === "login"
                ? "Mijozlar, savdo va jamoangizni boshqarishni davom ettiring."
                : "Hisob yarating — keyin sohangizni tanlab CRMni sozlaymiz."}
        </p>

        {!adminOnly && mode !== "recover" && (
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={mode === "login" ? "clay-raised bg-card py-2" : "rounded-xl py-2 text-muted-foreground"}
            >
              {t("Kirish")}
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={
                mode === "register" ? "clay-raised bg-card py-2" : "rounded-xl py-2 text-muted-foreground"
              }
            >
              {t("Ro‘yxatdan o‘tish")}
            </button>
          </div>
        )}


        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="full-name">{t("Ismingiz")}</Label>
                <Input
                  id="full-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder={t("Masalan: Nursultan")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-name">{t("Biznes nomi")}</Label>
                <Input
                  id="business-name"
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  placeholder={t("Masalan: KetaOne klinikasi")}
                />
              </div>
            </>
          )}
          {mode !== "recover" && (
            <div className="space-y-2">
              <Label htmlFor="email">{t("Email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("siz@kompaniya.uz")}
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">
              {mode === "recover" ? t("Yangi parol") : t("Parol")}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={mode === "login" ? undefined : 8}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? t("Parolni yashirish") : t("Parolni ko‘rsatish")}
                className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {mode !== "login" && (
              <p className="text-xs text-muted-foreground">{t("Kamida 8 belgi")}</p>
            )}
          </div>
          {mode === "recover" && (
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t("Parolni qayta kiriting")}</Label>
              <Input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
          )}
          {mode === "recover" && !resetToken && (
            <p className="text-sm text-destructive">
              {t("Tiklash havolasi topilmadi. Email orqali tiklash sozlanmagan — administrator bilan bog‘laning.")}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? t("Yuklanmoqda…")
              : mode === "recover"
                ? t("Parolni saqlash")
                : mode === "login"
                  ? t("Kirish")
                  : t("Ro‘yxatdan o‘tish")}
          </Button>
          {mode === "login" && !adminOnly && (
            <a
              href={CONTACT_EMAIL_HREF}
              className="block w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("Parolni unutdingizmi? {v0} manziliga yozing — administrator yangi parolni qo‘lda belgilaydi.", { v0: CONTACT_EMAIL })}
            </a>
          )}
        </form>

        <p className="mt-5 text-xs text-muted-foreground">
          {adminOnly
            ? t("Ro‘yxatdan o‘tish bu bo‘limda mavjud emas — faqat mavjud administrator hisobi bilan kiriladi.")
            : mode === "register"
              ? "Ro‘yxatdan o‘tgach biznes sohangizni tanlaysiz — CRM sizga moslab tayyorlanadi."
              : "Hisobingiz yo‘qmi? “Ro‘yxatdan o‘tish”ni tanlang — karta talab qilinmaydi."}
        </p>
      </div>

      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t("Bosh sahifaga")}
      </Link>
    </div>
  );
}
