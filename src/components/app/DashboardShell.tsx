import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Banknote,
  BarChart3,
  Book,
  Bot,
  Boxes,
  Building,
  Calendar,
  Car,
  Check,
  ClipboardList,
  Download,
  Eye,
  FileText,
  FlaskConical,
  Handshake,
  Home,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  ListChecks,
  LogOut,
  Menu,
  MessagesSquare,
  Package,
  Smartphone,
  Settings,
  Send,
  ShoppingCart,
  Sparkles,
  Stethoscope,
  Target,
  UserCog,
  UserRound,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import logoUrl from "@/assets/ketaone-logo.webp";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { NotificationsBell } from "@/components/app/NotificationsBell";
import { BRAND_TAGLINE } from "@/components/app/brand";
import { LanguageSwitcher } from "@/components/app/LanguageSwitcher";
import { QuickNewButton } from "@/components/app/crm-dialogs";
import { getMyCrmConfig } from "@/lib/crm-config.functions";
import { getPlatformNotice } from "@/lib/notifications.functions";
import { buildNavItems, mobileTabsForNav, type MobileTab, type NavSource } from "@/lib/nav";
import { isClubPreset, resolvePresetId, type PresetSection } from "@/lib/presets";
import { can } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { signOut as endSession } from "@/lib/auth.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

const ICONS: Record<string, LucideIcon> = {
  target: Target,
  users: Users,
  messages: MessagesSquare,
  cart: ShoppingCart,
  package: Package,
  boxes: Boxes,
  calendar: Calendar,
  book: Book,
  layers: Layers,
  user: UserRound,
  check: Check,
  clipboard: ClipboardList,
  car: Car,
  wrench: Wrench,
  stethoscope: Stethoscope,
  activity: Activity,
  flask: FlaskConical,
  file: FileText,
  home: Home,
  eye: Eye,
  handshake: Handshake,
  building: Building,
  // Preset registry icons (lib/presets.ts).
  dashboard: LayoutDashboard,
  pipeline: LayoutGrid,
  tasks: ListChecks,
  wallet: Wallet,
  finance: Landmark,
  payroll: Banknote,
  team: UserCog,
  chart: BarChart3,
  bot: Bot,
  sparkles: Sparkles,
  send: Send,
  settings: Settings,
  // Klub presetlari (PlayStation, Bilyard) bo'limlari.
  download: Download,
  phone: Smartphone,
  // Mobil pastki panelning so'nggi tugmasi.
  menu: Menu,
};

const SECTION_ORDER: PresetSection[] = ["core", "operations", "industry", "money", "team", "admin"];

const SECTION_LABELS: Record<PresetSection, string> = {
  core: "Asosiy",
  operations: "Amaliyot",
  industry: "Soha modullari",
  money: "Moliya",
  team: "Jamoa",
  admin: "Boshqaruv",
};

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fetchConfig = useServerFn(getMyCrmConfig);
  const { data: crm } = useQuery({ queryKey: ["crm-config"], queryFn: () => fetchConfig() });
  // Klub menyuda 4 bo'limdan boshqasi ko'rinmaydi — Sozlamalaga shu yerdan kiriladi,
  // aks holda biznes turini ortga qaytarib bo'lmaydi.
  const showClubSettings =
    isClubPreset(resolvePresetId(crm?.industry, crm?.config?.presetId)) &&
    can(crm?.role as never, "settings.manage");
  const items = buildNavItems(crm);
  const groups = SECTION_ORDER.map((section) => ({
    section,
    items: items.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0);

  return (
    <nav className="flex flex-col gap-1">
      {groups.map((group) => (
        <div key={group.section} className="flex flex-col gap-1">
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t(SECTION_LABELS[group.section])}
          </p>
          {group.items.map((item) => {
            const active =
              item.to === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.to);
            const Icon = ICONS[item.icon] ?? LayoutGrid;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "clay-raised bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground hover:shadow-clay-sm",
                )}
              >
                <Icon className="size-4" />
                {t(item.label)}
              </Link>
            );
          })}
        </div>
      ))}
      {showClubSettings ? (
        <Link
          to="/dashboard/settings"
          onClick={onNavigate}
          className={cn(
            "mt-2 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all",
            pathname.startsWith("/dashboard/settings")
              ? "clay-raised bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
          )}
        >
          <Settings className="size-4" />
          {t("Sozlamalar")}
        </Link>
      ) : null}
    </nav>
  );
}

/**
 * Telefonda pastki panel — qabul/tolov kabi amaliyotlar bir bosishda ochiladi.
 * Tugmalar preset va roldan keladi (lib/nav.ts), shuning uchun klubda 4 bo'lim,
 * salonlarda Asosiy/Qabullar/Kassa + Menyu ko'rinadi.
 */
function MobileTabBar({
  crm,
  menuOpen,
  onMenu,
}: {
  crm: NavSource | undefined;
  menuOpen: boolean;
  onMenu: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = mobileTabsForNav(crm);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-1 border-t border-border/60 bg-background/95 px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden">
      {tabs.map((tab) => {
        const Icon = ICONS[tab.icon] ?? LayoutGrid;
        const active = tab.isMenu
          ? menuOpen
          : tab.to === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(tab.to);
        const classes = cn(
          "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-medium transition-colors",
          active
            ? "clay-raised bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:text-foreground",
        );
        return tab.isMenu ? (
          <button key="menu" type="button" onClick={onMenu} className={classes} aria-label={t("Menyuni ochish")}>
            <Icon className="size-5" />
            {t(tab.label)}
          </button>
        ) : (
          <Link key={tab.to} to={tab.to} className={classes}>
            <Icon className="size-5" />
            <span className="w-full truncate px-0.5 text-center">{t(tab.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Shown when the Control Center closed the workspace (maintenance or a blocked account). */
function PlatformNoticeBanner() {
  const fetchNotice = useServerFn(getPlatformNotice);
  const { data } = useQuery({
    queryKey: ["platform-notice"],
    queryFn: () => fetchNotice(),
    refetchInterval: 120_000,
  });
  if (!data) return null;
  return (
    <div className="clay-panel flex items-start gap-3 border border-destructive/30 bg-destructive/5 p-4">
      <span className="clay-inset grid size-9 shrink-0 place-items-center">
        <Wrench className="size-4 text-destructive" />
      </span>
      <div>
        <p className="font-display text-sm font-semibold">
          {data.kind === "maintenance" ? t("Texnik ishlar rejimi") : t("Hisob vaqtincha bloklangan")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{data.message}</p>
      </div>
    </div>
  );
}

export function DashboardShell({
  children,
  email,
}: {
  children: React.ReactNode;
  email?: string | undefined;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const fetchConfig = useServerFn(getMyCrmConfig);
  const { data: crm } = useQuery({ queryKey: ["crm-config"], queryFn: () => fetchConfig() });
  // Klubda menyuni ochish tugmasi kerak: Sozlamalar pastki panelda emas, shu yerdan ochiladi.
  const isClub = isClubPreset(resolvePresetId(crm?.industry, crm?.config?.presetId));
  const signOut = async () => {
    try {
      await endSession();
    } catch (error) {
      toast.error(friendlyError(error, t("Chiqishda xatolik")));
      return;
    }
    navigate({ to: "/" });
  };

  const brand = (
    <div className="flex items-center gap-2 px-3 py-4">
      <span className="clay-raised grid size-10 place-items-center overflow-hidden rounded-2xl bg-card">
        <img src={logoUrl} alt={t("KetaOne logotipi")} className="size-8 object-contain" />
      </span>
      <div className="leading-tight">
        <p className="font-display text-sm font-semibold">KetaOne</p>
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{BRAND_TAGLINE}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-sidebar-border/60 bg-sidebar px-3 shadow-clay lg:flex">
        {brand}
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <NavLinks />
        </div>
        <div className="shrink-0 border-t border-sidebar-border py-4">
          <p className="truncate px-3 pb-2 text-xs text-muted-foreground">{email ?? ""}</p>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={signOut}>
            <LogOut className="size-4" /> {t("Chiqish")}
          </Button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-xl lg:px-8">
          <div className="flex items-center gap-2">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={cn("lg:hidden", !isClub && "hidden")}
                  aria-label={t("Menyuni ochish")}
                >
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col bg-sidebar px-3 shadow-clay-lg">
                {brand}
                <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                  <NavLinks onNavigate={() => setOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
            <span className="font-display text-sm font-semibold lg:hidden">KetaOne</span>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <LanguageSwitcher />
            <NotificationsBell />
            <QuickNewButton industry={crm?.industry} size="sm" />
            <span className="hidden text-xs text-muted-foreground lg:inline">{email}</span>
            <Button variant="outline" size="sm" className="gap-2" onClick={signOut}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">{t("Chiqish")}</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-28 pt-6 lg:px-8 lg:pb-6">
          <PlatformNoticeBanner />
          {children}
        </main>
        <MobileTabBar crm={crm} menuOpen={open} onMenu={() => setOpen(true)} />
      </div>
    </div>
  );
}
