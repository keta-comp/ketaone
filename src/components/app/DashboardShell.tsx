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
import { buildNavItems } from "@/lib/nav";
import type { PresetSection } from "@/lib/presets";
import { cn } from "@/lib/utils";
import { signOut as endSession } from "@/lib/auth.functions";
import { t } from "@/lib/i18n";

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
  const signOut = async () => {
    try {
      await endSession();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Chiqishda xatolik"));
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
                <Button variant="outline" size="icon" className="lg:hidden" aria-label={t("Menyuni ochish")}>
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
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-8">
          <PlatformNoticeBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
