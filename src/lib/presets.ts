/**
 * Central industry-preset registry (KetaOne brief §7.1).
 * Client-safe. Depends on crm-config.ts — never the reverse.
 *
 * A preset describes the *business identity* (menu, enabled modules, booking
 * semantics, reports, defaults). The CRM field/module payloads stay in
 * crm-config.ts (INDUSTRY_PRESETS) and are selected through `industryKey`.
 */

import {
  GENERIC_PRESET,
  INDUSTRY_PRESETS,
  type CrmConfigData,
  type CrmField,
  type CrmModule,
  type CrmWidget,
  type IndustryOption,
} from "./crm-config";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "./booking";
import type { Permission } from "./roles";

/** What "booking" means for this industry (brief §4.3). */
export type BookingType =
  "appointment" | "trial_lesson" | "order" | "viewing" | "home_visit" | "project_meeting";

export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  appointment: "Qabul",
  trial_lesson: "Sinov darsi",
  order: "Buyurtma",
  viewing: "Obyektni ko‘rish",
  home_visit: "Manzilga chiqish",
  project_meeting: "Uchrashuv",
};

export type PresetSection = "core" | "industry" | "operations" | "money" | "team" | "admin";

/** Dashboard routes a preset menu can point at. Every value has a real page. */
export type CoreKey =
  | "pipeline"
  | "customers"
  | "orders"
  | "products"
  | "inventory"
  | "appointments"
  | "tasks"
  | "payments"
  | "finance"
  | "employees"
  | "branches"
  | "payroll"
  | "team";

/**
 * Yakka forma — sahifa sarlavhalari, "Yangi …" tugmalari va toastlar uchun.
 * Preset `singles` keltirmasa shu umumiy nom ishlatiladi.
 */
const CORE_SINGLES: Record<CoreKey, string> = {
  pipeline: "Sotuv quvuri",
  customers: "Mijoz",
  orders: "Buyurtma",
  products: "Xizmat yoki mahsulot",
  inventory: "Ombordagi pozitsiya",
  appointments: "Qabul",
  tasks: "Vazifa",
  payments: "To‘lov",
  finance: "Moliyaviy amal",
  employees: "Xodim",
  branches: "Filial",
  payroll: "Oylik",
  team: "A’zo",
};

/** Legacy CRM entry points kept in the shared navigation (AGENTS.md rule). */
const LEGACY_CORE_KEYS: CoreKey[] = ["customers", "orders", "products"];

export interface PresetMenuItem {
  to: string;
  label: string;
  icon: string;
  section: PresetSection;
  /** Omitted = visible for every role. Filtering by role happens in the shell. */
  permission?: Permission;
}

export interface PresetDefaults {
  currency: string;
  timezone: string;
  workStart: string;
  workEnd: string;
  slotMinutes: number;
}

export type ReportKey =
  "revenue" | "expenses" | "profit" | "customers" | "appointments" | "pipeline" | "staff" | "stock";

export interface IndustryPreset {
  id: string;
  /** Key into INDUSTRY_PRESETS; sub-presets reuse their parent's data shape. */
  industryKey: string;
  /** Set for sub-presets (Sartaroshxona → Beauty salon). */
  parentId?: string;
  emoji: string;
  name: string;
  /** Short label for sub-preset pickers (falls back to `name`). */
  shortName?: string;
  description: string;
  bookingType: BookingType;
  /** Preset-specific additions on top of LEGACY_CORE_KEYS. */
  extraCoreKeys: CoreKey[];
  /** Renames of legacy/extra core items ("Bemorlar" instead of "Mijozlar"). */
  labels?: Partial<Record<CoreKey, string>>;
  /**
   * Yakka forma — sahifa sarlavhasi va "Yangi …" tugmalari uchun ("Kurs", "Bemor").
   * Keltirilmagan holda umumiylashgan shakl ishlatiladi.
   */
  singles?: Partial<Record<CoreKey, string>>;
  /** One entry per dynamic (non-linked) module of the industry config. */
  industryItems: PresetMenuItem[];
  /** Industry modules this preset does not use at all. */
  hiddenModuleKeys: string[];
  /** Core sections this preset never shows — menu, cross-page links and the pages themselves. */
  hiddenCoreKeys?: CoreKey[];
  /**
   * Modules holding patient data. Kept in code (never in the stored config) so a tenant
   * cannot unlock medical records by editing its own CRM JSON; server-side checks use this.
   */
  medicalModuleKeys?: string[];
  reports: ReportKey[];
  defaults: PresetDefaults;
  /**
   * Bo'lim-san'li preset (PlayStation, Bilyard): ro'yxatdagi har bir yo'nalishdan tashqari
   * barcha dashboard sahifalari — ADMIN_TAIL ham — yashiriladi. Qora ro'yxat (`hiddenCoreKeys`)
   * ularni yashira olmaydi, chunki klubda umuman CRM bo'limi bo'lmaydi.
   */
  allowedRoutes?: string[];
  /** `/dashboard` o'rniga tushiladigan sahifa. Klub presetlarida dashboard yo'q. */
  homeRoute?: string;
  /** "Qabul" so'zi klubda ma'noni ochmaydi — bron deyiladi. */
  bookingLabel?: string;
}

const CORE_ITEMS: Record<CoreKey, PresetMenuItem> = {
  pipeline: { to: "/dashboard/pipeline", label: "Pipeline", icon: "pipeline", section: "core" },
  customers: { to: "/dashboard/customers", label: "Mijozlar", icon: "users", section: "core" },
  orders: { to: "/dashboard/orders", label: "Buyurtmalar", icon: "cart", section: "core" },
  products: {
    to: "/dashboard/products",
    label: "Xizmatlar va mahsulotlar",
    icon: "package",
    section: "core",
  },
  inventory: {
    to: "/dashboard/inventory",
    label: "Ombor",
    icon: "boxes",
    section: "core",
    permission: "catalog.manage",
  },
  appointments: {
    to: "/dashboard/appointments",
    label: "Qabul va bron",
    icon: "calendar",
    section: "operations",
  },
  tasks: { to: "/dashboard/tasks", label: "Vazifalar", icon: "tasks", section: "operations" },
  payments: {
    to: "/dashboard/payments",
    label: "To‘lovlar",
    icon: "wallet",
    section: "money",
    permission: "finance.view",
  },
  finance: {
    to: "/dashboard/finance",
    label: "Moliya",
    icon: "finance",
    section: "money",
    permission: "finance.view",
  },
  employees: { to: "/dashboard/employees", label: "Xodimlar", icon: "users", section: "team" },
  branches: { to: "/dashboard/branches", label: "Filiallar", icon: "building", section: "team" },
  payroll: {
    to: "/dashboard/payroll",
    label: "Oylik",
    icon: "payroll",
    section: "money",
    permission: "finance.view",
  },
  team: {
    to: "/dashboard/team",
    label: "Jamoa va rollar",
    icon: "team",
    section: "team",
    permission: "members.manage",
  },
};

/**
 * Sections no preset offers any more. "Murojaatlar" bundan buyon mahsulotda yo‘q:
 * sahifa, menyudagi joyi va tez yaratish tugmasi olib tashlandi.
 */
const ALWAYS_HIDDEN_ROUTES: string[] = ["/dashboard/leads"];

const ADMIN_TAIL: PresetMenuItem[] = [
  {
    to: "/dashboard/analytics",
    label: "Hisobotlar",
    icon: "chart",
    section: "admin",
    permission: "reports.export",
  },
  { to: "/dashboard/assistant", label: "AI yordamchi", icon: "bot", section: "admin" },
  {
    to: "/dashboard/crm-builder",
    label: "AI CRM sozlash",
    icon: "sparkles",
    section: "admin",
    permission: "settings.manage",
  },
  {
    to: "/dashboard/telegram",
    label: "Telegram",
    icon: "send",
    section: "admin",
    permission: "settings.manage",
  },
  {
    to: "/dashboard/billing",
    label: "Tarif va to‘lov",
    icon: "wallet",
    section: "admin",
    permission: "settings.manage",
  },
  {
    to: "/dashboard/settings",
    label: "Sozlamalar",
    icon: "settings",
    section: "admin",
    permission: "settings.manage",
  },
];

const DEFAULTS: PresetDefaults = {
  currency: "UZS",
  timezone: "Asia/Tashkent",
  workStart: "09:00",
  workEnd: "18:00",
  slotMinutes: 30,
};

/**
 * Har bir dashboard yo'nalishi — `allowedRoutes` shu to'plamdan chegirtilib hisoblaydi.
 * Yangi sahifa qo'shilganda shu yerga ham yoziladi, aks holda o'sha sahifa bo'lim-san'li
 * presetda (klublar) ochiq qolib ketadi.
 */
const ALL_DASHBOARD_ROUTES: string[] = [
  "/dashboard",
  ...Object.values(CORE_ITEMS).map((item) => item.to),
  ...ADMIN_TAIL.map((item) => item.to),
  // Sahifaga ega bo'lgan soha bo'limlari (CRM moduli emas).
  "/dashboard/services",
  "/dashboard/courses",
  "/dashboard/groups",
  "/dashboard/attendance",
  "/dashboard/booking",
  "/dashboard/program",
  "/dashboard/mobile",
];

/** Klub sohasidagi bron — vaqt hisoblagichi tashqi dasturda, bu yerda faqat bron o'zi. */
const CLUB_BOOKING_ITEM: PresetMenuItem = {
  to: "/dashboard/booking",
  label: "Bron va qabul sozlamalari",
  icon: "calendar",
  section: "core",
};

/** Klub menyusi 1–2-bo'limlari: tarqatish sahifalari (`program_releases` jadvalidan o'qiydi). */
const CLUB_DOWNLOAD_ITEM: PresetMenuItem = {
  to: "/dashboard/program",
  label: "Dasturni yuklab olish",
  icon: "download",
  section: "core",
};

const CLUB_MOBILE_ITEM: PresetMenuItem = {
  to: "/dashboard/mobile",
  label: "Mobil dastur",
  icon: "phone",
  section: "core",
};

/** Telegram bo'limi — ADMIN_TAIL'dagi sahifaning o'zi, klub menyuda oldinga chiqadi. */
const CLUB_TELEGRAM_ITEM: PresetMenuItem = {
  to: "/dashboard/telegram",
  label: "Telegram",
  icon: "send",
  section: "core",
  permission: "settings.manage",
};

/**
 * Klublarda CRM yadrosi (mijoz, buyurtma, ombor, xodim, moliya, hisobot) umuman
 * ishlatilmaydi: sessiya hisobi tashqi vaqt hisoblagichida qoladi.
 */
const CLUB_ALLOWED_ROUTES: string[] = [
  CLUB_DOWNLOAD_ITEM.to,
  CLUB_MOBILE_ITEM.to,
  CLUB_TELEGRAM_ITEM.to,
  CLUB_BOOKING_ITEM.to,
  CORE_ITEMS.appointments.to,
];

/** Shu uchta sahifa faqat klub presetlarida ochiladi — boshqa sohada butunlay yopiq. */
const CLUB_ONLY_ROUTES: string[] = [
  CLUB_DOWNLOAD_ITEM.to,
  CLUB_MOBILE_ITEM.to,
  CLUB_BOOKING_ITEM.to,
];

function dynamicItem(key: string, label: string, icon: string): PresetMenuItem {
  return { to: `/dashboard/crm/${key}`, label, icon, section: "industry" };
}

/** Payment module label differs per industry; the payload is shared. */
const paymentsItem = (label = "To‘lovlar") => dynamicItem("tolovlar", label, "wallet");

/** Patient-data modules: hidden from roles without `medical.view` (server enforces too). */
const medicalItem = (key: string, label: string, icon: string): PresetMenuItem => ({
  ...dynamicItem(key, label, icon),
  permission: "medical.view",
});

/** Xizmatlar katalogi — `services` jadvali, bron va depozit shu yerdan oladi. */
const servicesItem = (label = "Xizmatlar"): PresetMenuItem => ({
  to: "/dashboard/services",
  label,
  icon: "package",
  section: "industry",
});

const PRESET_LIST: IndustryPreset[] = [
  {
    id: "stomatologiya",
    industryKey: "stomatologiya",
    emoji: "🦷",
    name: "Stomatologiya",
    description: "Bemorlar, qabul jadvali, davolash rejalari va shifokorlar ulushi.",
    bookingType: "appointment",
    extraCoreKeys: [
      "appointments",
      "tasks",
      "payments",
      "finance",
      "inventory",
      "employees",
      "payroll",
      "team",
    ],
    labels: { customers: "Bemorlar", products: "Mahsulotlar", employees: "Shifokorlar" },
    singles: { customers: "Bemor", products: "Mahsulot", employees: "Shifokor" },
    industryItems: [
      servicesItem("Xizmatlar va narxlar"),
      medicalItem("odontogramma", "Odontogramma", "activity"),
      medicalItem("bemor_kartasi", "Bemor kartasi", "clipboard"),
      dynamicItem("davolash", "Davolash rejalari", "check"),
      medicalItem("rentgen", "Rentgen va hujjatlar", "file"),
    ],
    // Xizmat — services katalogida, shifokor — xodimlar sahifasida, qabul — appointments,
    // to‘lov — payments jadvalida. Ularning erkin matn modullari menyudan olinadi
    // (ikkinchi jo'natma bo'lmasin; yozuvlar o'chirilmaydi).
    hiddenModuleKeys: ["qabul", "shifokorlar", "tolovlar"],
    hiddenCoreKeys: ["orders"],
    medicalModuleKeys: ["odontogramma", "bemor_kartasi", "rentgen"],
    reports: ["revenue", "expenses", "profit", "customers", "appointments", "staff", "stock"],
    defaults: { ...DEFAULTS, slotMinutes: 60 },
  },
  {
    id: "klinika",
    industryKey: "klinika",
    emoji: "🏥",
    name: "Klinika / Tibbiyot",
    description: "Bemorlar, qabul va navbat, bo‘limlar, tahlillar va to‘lovlar.",
    bookingType: "appointment",
    extraCoreKeys: [
      "appointments",
      "tasks",
      "payments",
      "finance",
      "inventory",
      "employees",
      "payroll",
      "team",
    ],
    labels: { customers: "Bemorlar", products: "Mahsulotlar", employees: "Shifokorlar" },
    singles: { customers: "Bemor", products: "Mahsulot", employees: "Shifokor" },
    industryItems: [
      servicesItem("Xizmatlar va narxlar"),
      dynamicItem("bolimlar", "Bo‘limlar", "building"),
      medicalItem("tibbiy_karta", "Tibbiy kartalar", "clipboard"),
      medicalItem("koriklar", "Ko‘rik va tashxis", "activity"),
      medicalItem("tahlillar", "Tahlillar", "flask"),
      dynamicItem("davolash_rejasi", "Davolash rejasi", "check"),
      medicalItem("hujjatlar", "Tibbiy hujjatlar", "file"),
    ],
    // Qabul — appointments, shifokor — xodimlar, to‘lov — payments jadvalida;
    // ularning erkin matn modullari menyudan olinadi (yozuvlar saqlanadi).
    hiddenModuleKeys: ["qabul", "shifokorlar", "tolovlar"],
    hiddenCoreKeys: ["orders"],
    medicalModuleKeys: ["tibbiy_karta", "koriklar", "tahlillar", "hujjatlar"],
    reports: ["revenue", "expenses", "profit", "customers", "appointments", "staff"],
    defaults: { ...DEFAULTS, slotMinutes: 30 },
  },
  {
    id: "oquv",
    industryKey: "oquv",
    emoji: "🎓",
    name: "O‘quv markazi",
    description: "O‘quvchilar, kurslar, guruhlar, davomat va oylik to‘lovlar.",
    bookingType: "trial_lesson",
    extraCoreKeys: ["appointments", "tasks", "payments", "finance", "employees", "payroll", "team"],
    labels: { customers: "O‘quvchilar", products: "Kurslar" },
    singles: { customers: "O‘quvchi", appointments: "Sinov darsi", products: "Kurs" },
    industryItems: [
      { to: "/dashboard/courses", label: "Kurslar", icon: "book", section: "industry" },
      { to: "/dashboard/groups", label: "Guruhlar", icon: "layers", section: "industry" },
      { to: "/dashboard/attendance", label: "Davomat", icon: "check", section: "industry" },
      paymentsItem(),
    ],
    // Kurs endi `services` katalogidagi haqiqiy obyekt, o‘qituvchi esa xodim,
    // shuning uchun ularning erkin matn modullari va mahsulot katalogi yashiriladi.
    hiddenModuleKeys: ["kurslar", "guruhlar", "oqituvchilar"],
    hiddenCoreKeys: ["orders", "inventory", "products"],
    reports: ["revenue", "expenses", "profit", "customers", "staff"],
    defaults: { ...DEFAULTS, slotMinutes: 90 },
  },
  {
    id: "ecommerce",
    industryKey: "ecommerce",
    emoji: "📦",
    name: "E-commerce",
    description: "Buyurtmalar, mahsulotlar, ombor qoldiqlari va yetkazib berish.",
    bookingType: "order",
    extraCoreKeys: ["inventory", "tasks", "payments", "finance", "team"],
    labels: { products: "Mahsulotlar" },
    singles: { products: "Mahsulot" },
    industryItems: [paymentsItem()],
    hiddenModuleKeys: [],
    reports: ["revenue", "expenses", "profit", "customers", "stock"],
    defaults: DEFAULTS,
  },
  {
    id: "avtoservis",
    industryKey: "avtoservis",
    emoji: "🚗",
    name: "Avtoservis",
    description: "Avtomobillar, servis buyurtmalari, ustalar va ehtiyot qismlar.",
    bookingType: "appointment",
    extraCoreKeys: [
      "pipeline",
      "appointments",
      "tasks",
      "inventory",
      "payments",
      "finance",
      "employees",
      "payroll",
      "team",
    ],
    labels: { orders: "Servis buyurtmalari", products: "Ehtiyot qismlar", employees: "Ustalar" },
    singles: { orders: "Servis buyurtmasi", products: "Ehtiyot qism", employees: "Usta" },
    industryItems: [
      servicesItem("Xizmatlar va narxlar"),
      dynamicItem("avtomobillar", "Avtomobillar", "car"),
      dynamicItem("servis", "Servis buyurtmalari", "wrench"),
    ],
    // Usta — xodimlar jadvalida (jadval, ta'til, komissiya), to‘lov — payments'ida,
    // xizmat narxlari — services katalogida. Takror bo'limlar menyudan olinadi.
    hiddenModuleKeys: ["ustalar", "tolovlar"],
    hiddenCoreKeys: ["orders"],
    reports: ["revenue", "expenses", "profit", "customers", "appointments", "staff", "stock"],
    defaults: { ...DEFAULTS, slotMinutes: 60 },
  },
  {
    id: "kochmas_mulk",
    industryKey: "kochmas_mulk",
    emoji: "🏠",
    name: "Ko‘chmas mulk",
    description: "Obyektlar, ko‘rish jadvali, muzokaralar, bitimlar va komissiyalar.",
    bookingType: "viewing",
    extraCoreKeys: [
      "pipeline",
      "appointments",
      "tasks",
      "payments",
      "finance",
      "employees",
      "payroll",
      "team",
    ],
    labels: { products: "Xizmatlar va komissiyalar", appointments: "Ko‘rish jadvali" },
    singles: { products: "Xizmat yoki komissiya", appointments: "Ko‘rish" },
    industryItems: [
      dynamicItem("obyekt", "Obyektlar", "home"),
      dynamicItem("korishlar", "Ko‘rishlar", "eye"),
      dynamicItem("bitimlar", "Bitimlar", "handshake"),
    ],
    hiddenModuleKeys: [],
    reports: ["revenue", "profit", "customers", "pipeline", "staff"],
    defaults: { ...DEFAULTS, slotMinutes: 60 },
  },
  {
    id: "beauty",
    industryKey: "beauty",
    emoji: "💇",
    name: "Beauty salon / Barbershop",
    shortName: "Beauty salon",
    description: "Ustalar, xizmatlar va narxlar, onlayn qabul, kassa va Usta komissiyasi.",
    bookingType: "appointment",
    extraCoreKeys: [
      "appointments",
      "tasks",
      "inventory",
      "payments",
      "finance",
      "employees",
      "payroll",
      "team",
    ],
    labels: { products: "Mahsulotlar", employees: "Ustalar" },
    singles: { products: "Mahsulot", employees: "Usta" },
    industryItems: [servicesItem()],
    // Har bir salon obyekti yadro sahifasida: xizmat — Xizmatlar, usta — Ustalar,
    // qabul — Qabul va bron, to‘lov — To‘lovlar. Erkin matn modullari ikkinchi
    // jo'natma bo'lmasligi uchun yashiriladi (ularning yozuvlari o'chirilmaydi).
    hiddenModuleKeys: ["qabul", "xizmatlar", "ustalar", "tolovlar"],
    hiddenCoreKeys: ["orders"],
    reports: ["revenue", "expenses", "profit", "customers", "appointments", "staff", "stock"],
    defaults: { ...DEFAULTS, workStart: "10:00", workEnd: "20:00", slotMinutes: 60 },
  },
  {
    id: "barbershop",
    industryKey: "beauty",
    parentId: "beauty",
    emoji: "💈",
    name: "Sartaroshxona",
    description: "Tezkor qabul, sartaroshlar, xizmat narxlari va kunlik kassa.",
    bookingType: "appointment",
    extraCoreKeys: [
      "appointments",
      "tasks",
      "inventory",
      "payments",
      "finance",
      "employees",
      "payroll",
      "team",
    ],
    labels: { products: "Mahsulotlar", employees: "Sartaroshlar", appointments: "Onlayn qabul" },
    singles: { products: "Mahsulot", employees: "Sartarosh" },
    industryItems: [servicesItem("Xizmatlar va narxlar")],
    hiddenModuleKeys: ["qabul", "xizmatlar", "ustalar", "tolovlar"],
    hiddenCoreKeys: ["orders"],
    reports: ["revenue", "profit", "appointments", "staff"],
    defaults: { ...DEFAULTS, workStart: "09:00", workEnd: "20:00", slotMinutes: 30 },
  },
  {
    id: "qurilish",
    industryKey: "qurilish",
    emoji: "🏗",
    name: "Qurilish",
    description: "Loyihalar, smetalar, bajarilgan ishlar, materiallar va avanslar.",
    bookingType: "project_meeting",
    extraCoreKeys: [
      "pipeline",
      "appointments",
      "tasks",
      "inventory",
      "payments",
      "finance",
      "employees",
      "branches",
      "payroll",
      "team",
    ],
    labels: { orders: "Bajarilgan ishlar", products: "Ishlar va materiallar" },
    singles: { orders: "Bajarilgan ish", products: "Ish yoki material" },
    industryItems: [
      dynamicItem("loyihalar", "Loyihalar", "building"),
      dynamicItem("pudratchilar", "Pudratchilar", "user"),
      paymentsItem("Avanslar va to‘lovlar"),
    ],
    hiddenModuleKeys: [],
    reports: ["revenue", "expenses", "profit", "customers", "staff", "stock"],
    defaults: DEFAULTS,
  },
  {
    id: "xizmat",
    industryKey: "xizmat",
    emoji: "💼",
    name: "Xizmat ko‘rsatish",
    description: "Buyurtmalar, manzillar, brigadalar jadvali va bajarilgan ishlar.",
    bookingType: "home_visit",
    extraCoreKeys: [
      "pipeline",
      "appointments",
      "tasks",
      "inventory",
      "payments",
      "finance",
      "employees",
      "branches",
      "team",
    ],
    labels: { orders: "Buyurtmalar", products: "Mahsulotlar", appointments: "Jadval va marshrut" },
    singles: { products: "Mahsulot", appointments: "Manzilga chiqish" },
    industryItems: [servicesItem("Xizmatlar")],
    // Xizmat — services katalogidagi obyekt, to‘lov — payments jadvalida;
    // ularning erkin matn modullari menyudan olinadi (yozuvlar saqlanadi).
    hiddenModuleKeys: ["xizmatlar", "tolovlar"],
    reports: ["revenue", "expenses", "profit", "customers", "appointments", "staff"],
    defaults: DEFAULTS,
  },
  {
    id: "smm",
    industryKey: "smm",
    emoji: "📱",
    name: "SMM / Marketing agentligi",
    description: "Mijozlar, loyihalar, kontent vazifalari va oylik to‘lovlar.",
    bookingType: "project_meeting",
    extraCoreKeys: ["pipeline", "tasks", "payments", "finance", "employees", "team"],
    labels: { products: "Xizmat paketlari" },
    singles: { products: "Xizmat paketi" },
    industryItems: [
      dynamicItem("loyihalar", "Loyihalar", "building"),
      paymentsItem("Oylik to‘lovlar"),
    ],
    hiddenModuleKeys: [],
    reports: ["revenue", "expenses", "profit", "customers", "pipeline", "staff"],
    defaults: DEFAULTS,
  },
  {
    id: "playstation",
    industryKey: "playstation",
    emoji: "🎮",
    name: "PlayStation klub",
    description:
      "Tashqi vaqt hisoblagichi dasturi, mobil ilova havolalari, Telegram va bron sozlamalari.",
    bookingType: "appointment",
    bookingLabel: "Bron",
    extraCoreKeys: [],
    labels: {},
    industryItems: [CLUB_DOWNLOAD_ITEM, CLUB_MOBILE_ITEM, CLUB_TELEGRAM_ITEM, CLUB_BOOKING_ITEM],
    hiddenModuleKeys: [],
    reports: [],
    defaults: { ...DEFAULTS, workStart: "10:00", workEnd: "23:00", slotMinutes: 60 },
    allowedRoutes: CLUB_ALLOWED_ROUTES,
    homeRoute: CLUB_DOWNLOAD_ITEM.to,
  },
  {
    id: "bilyard",
    industryKey: "bilyard",
    emoji: "🎱",
    name: "Bilyard klub",
    description:
      "Tashqi vaqt hisoblagichi dasturi, mobil ilova havolalari, Telegram va stollar bron sozlamalari.",
    bookingType: "appointment",
    bookingLabel: "Bron",
    extraCoreKeys: [],
    labels: {},
    industryItems: [CLUB_DOWNLOAD_ITEM, CLUB_MOBILE_ITEM, CLUB_TELEGRAM_ITEM, CLUB_BOOKING_ITEM],
    hiddenModuleKeys: [],
    reports: [],
    defaults: { ...DEFAULTS, workStart: "12:00", workEnd: "23:00", slotMinutes: 60 },
    allowedRoutes: CLUB_ALLOWED_ROUTES,
    homeRoute: CLUB_DOWNLOAD_ITEM.to,
  },
  {
    id: "universal",
    industryKey: "boshqa",
    emoji: "⚙️",
    name: "Boshqa",
    description: "Har qanday soha uchun universal CRM — modullarni o‘zingiz sozlaysiz.",
    bookingType: "appointment",
    extraCoreKeys: [
      "pipeline",
      "appointments",
      "tasks",
      "payments",
      "finance",
      "employees",
      "branches",
      "team",
    ],
    labels: {},
    industryItems: [paymentsItem()],
    hiddenModuleKeys: [],
    reports: ["revenue", "expenses", "profit", "customers", "pipeline", "appointments"],
    defaults: DEFAULTS,
  },
];

export const PRESETS: Record<string, IndustryPreset> = Object.fromEntries(
  PRESET_LIST.map((preset) => [preset.id, preset]),
);

export const UNIVERSAL_PRESET_ID = "universal";

const PRESET_ID_BY_INDUSTRY: Record<string, string> = Object.fromEntries(
  PRESET_LIST.filter((p) => p.parentId === undefined).map((p) => [p.industryKey, p.id]),
);

/** Children of a parent preset, keyed by parent id (beauty → barbershop). */
export const SUB_PRESETS: Record<string, IndustryPreset[]> = (() => {
  const map: Record<string, IndustryPreset[]> = {};
  for (const preset of PRESET_LIST) {
    const parentId = preset.parentId;
    if (!parentId) continue;
    const siblings = map[parentId] ?? [];
    siblings.push(preset);
    map[parentId] = siblings;
  }
  return map;
})();

const UNIVERSAL_PRESET = PRESETS[UNIVERSAL_PRESET_ID] as IndustryPreset;

/** Industry picker options, derived from the registry (parents only). */
export const INDUSTRIES: IndustryOption[] = PRESET_LIST.filter(
  (preset) => preset.parentId === undefined,
).map((preset) => ({ key: preset.industryKey, emoji: preset.emoji, label: preset.name }));

export function presetForId(id: string | null | undefined): IndustryPreset | undefined {
  return id ? PRESETS[id] : undefined;
}

/** Explicit presetId wins; otherwise the stored industry label decides. */
export function resolvePresetId(
  industry: string | null | undefined,
  presetId?: string | null,
): string {
  if (presetId && PRESETS[presetId]) return presetId;
  return PRESET_ID_BY_INDUSTRY[industry ?? ""] ?? UNIVERSAL_PRESET_ID;
}

export function presetForConfig(
  industry: string | null | undefined,
  config: CrmConfigData | null | undefined,
): IndustryPreset {
  return PRESETS[resolvePresetId(industry, config?.presetId)] ?? UNIVERSAL_PRESET;
}

/** Module payload for a preset (the industry it is built on). */
export function crmConfigForPreset(id: string): CrmConfigData {
  const preset = PRESETS[id];
  if (!preset) return GENERIC_PRESET;
  return INDUSTRY_PRESETS[preset.industryKey] ?? GENERIC_PRESET;
}

/** Stored configs predate presetId — fill it in so the UI always has an identity. */
export function attachPresetId(
  industry: string | null | undefined,
  config: CrmConfigData,
): CrmConfigData {
  const presetId = resolvePresetId(industry, config.presetId);
  if (config.presetId === presetId) return config;
  return { ...config, presetId };
}

export function enabledModuleKeys(id: string): string[] {
  const preset = PRESETS[id];
  const hidden = new Set(preset?.hiddenModuleKeys ?? []);
  return crmConfigForPreset(id)
    .modules.map((m) => m.key)
    .filter((key) => !hidden.has(key));
}

export function isModuleEnabled(id: string, moduleKey: string): boolean {
  const preset = PRESETS[id];
  if (!preset) return true;
  // Bo'lim-san'li preset (klublar) hech qanday CRM modulini ko'rsatmaydi: saqlangan
  // konfiguratsiyada modul qolsa ham sahifasi bloklangan.
  if (preset.allowedRoutes) return false;
  return !preset.hiddenModuleKeys.includes(moduleKey);
}

/** Core routes this preset must not show anywhere: menu entry, cross-page link, page. */
export function hiddenRoutesForPreset(id: string): Set<string> {
  const preset = PRESETS[id] ?? UNIVERSAL_PRESET;
  const hidden = new Set(ALWAYS_HIDDEN_ROUTES);
  if (preset.allowedRoutes) {
    // Oq ro'yxat: sanab o'tilmagan har bir dashboard sahifasi — ADMIN_TAIL ham — yopiq.
    const allowed = new Set(preset.allowedRoutes);
    for (const to of ALL_DASHBOARD_ROUTES) if (!allowed.has(to)) hidden.add(to);
    return hidden;
  }
  for (const key of preset.hiddenCoreKeys ?? []) hidden.add(CORE_ITEMS[key].to);
  // Klub sahifalari (dastur, mobil ilova, bron) faqat oq ro'yxatli presetlarda ochiladi:
  // boshqa sohada ular menyuga chiqmaydi va URL orqali ham kirib bo'lmaydi.
  for (const to of CLUB_ONLY_ROUTES) hidden.add(to);
  return hidden;
}

/**
 * Route-level answer to "may this preset open the page at all". `hiddenRoutesForPreset`
 * cannot name every CRM module page, so module routes are decided here instead.
 */
export function isRouteAllowed(id: string, to: string): boolean {
  const preset = PRESETS[id] ?? UNIVERSAL_PRESET;
  if (preset.allowedRoutes) {
    if (to.startsWith("/dashboard/crm/")) return false;
    return preset.allowedRoutes.includes(to);
  }
  return !hiddenRoutesForPreset(id).has(to);
}

export function isSectionVisible(id: string, to: string): boolean {
  return !hiddenRoutesForPreset(id).has(to);
}

/** Bo'lim-san'li presetda "Umumiy ko‘rinish" yo'q — `/dashboard` shu sahifaga yuboriladi. */
export function homeRouteForPreset(id: string | null | undefined): string | null {
  return id ? PRESETS[id]?.homeRoute ?? null : null;
}

/**
 * URL bo'yi bo'lim ochiqligini tekshiradi. `/dashboard/customers/42` kabi ichki yo'l
 * o'z bo'limi bilan birga yopiladi; bo'lim-san'li presetda (klublar) ro'yxatdagi aniq
 * yo'nalishdan tashqari hech narsa ochilmaydi, CRM modul sahifalari ham shunga kiradi.
 */
export function isRouteAllowedForPath(id: string, pathname: string): boolean {
  const preset = PRESETS[id] ?? UNIVERSAL_PRESET;
  if (preset.allowedRoutes) {
    return !pathname.startsWith("/dashboard/crm/") && preset.allowedRoutes.includes(pathname);
  }
  const hidden = hiddenRoutesForPreset(id);
  for (const route of hidden) {
    if (route === "/dashboard") continue;
    if (pathname === route || pathname.startsWith(`${route}/`)) return false;
  }
  return true;
}

/** Modules holding patient data (diagnoses, lab results, medical cards) for this preset. */
export function medicalModuleKeys(id: string): string[] {
  return PRESETS[id]?.medicalModuleKeys ?? [];
}

export function isMedicalModule(id: string, moduleKey: string): boolean {
  return medicalModuleKeys(id).includes(moduleKey);
}

/**
 * Modules a tenant has but a target preset no longer offers. Switching presets
 * never deletes rows — these keys become orphans and must be reported instead of
 * silently disappearing from the menu.
 *
 * Keys hidden on purpose (`hiddenModuleKeys`) are still offered when the target's own
 * registry ships them: the module was replaced by a dedicated page (Kurslar, Guruhlar),
 * its records stay meaningful, so nothing is orphaned.
 */
export function droppedModulesForPreset(config: CrmConfigData, targetId: string): CrmModule[] {
  const offered = new Set(enabledModuleKeys(targetId));
  for (const module of crmConfigForPreset(targetId).modules) offered.add(module.key);
  return config.modules.filter((module) => !offered.has(module.key));
}

/**
 * Registry parts a stored config predates (modules, widgets or fields shipped after the
 * tenant onboarded). Syncing appends these; existing modules, fields and records are never
 * touched, so an admin who removed something keeps it removed until they ask for the sync.
 */
export function missingPresetParts(
  config: CrmConfigData,
  presetId: string,
): {
  modules: CrmModule[];
  widgets: CrmWidget[];
  fields: { moduleKey: string; fields: CrmField[] }[];
} {
  const preset = PRESETS[presetId];
  if (!preset) return { modules: [], widgets: [], fields: [] };
  const registry = crmConfigForPreset(presetId);
  const storedByKey = new Map(config.modules.map((m) => [m.key, m]));
  const hasWidget = new Set(config.dashboardWidgets.map((w) => w.key));
  const fields = registry.modules
    .map((module) => {
      const stored = storedByKey.get(module.key);
      if (!stored || !module.fields?.length) return null;
      const known = new Set((stored.fields ?? []).map((f) => f.key));
      const missingFields = module.fields.filter((f) => !known.has(f.key));
      return missingFields.length ? { moduleKey: module.key, fields: missingFields } : null;
    })
    .filter((entry): entry is { moduleKey: string; fields: CrmField[] } => entry !== null);
  return {
    modules: registry.modules.filter(
      (m) => !storedByKey.has(m.key) && isModuleEnabled(presetId, m.key),
    ),
    widgets: registry.dashboardWidgets.filter((w) => !hasWidget.has(w.key)),
    fields,
  };
}

/**
 * Append everything `missingPresetParts` found to a stored config. Existing modules keep
 * their order and their fields; new fields are appended at the end of that module's form,
 * so stored `crm_records.data` never needs a rewrite.
 */
export function applyMissingParts(
  config: CrmConfigData,
  presetId: string,
): { config: CrmConfigData; missing: ReturnType<typeof missingPresetParts> } {
  const missing = missingPresetParts(config, presetId);
  const fieldsByModule = new Map(missing.fields.map((entry) => [entry.moduleKey, entry.fields]));
  const next: CrmConfigData = {
    ...config,
    presetId,
    modules: [
      ...config.modules.map((module) => {
        const added = fieldsByModule.get(module.key);
        return added ? { ...module, fields: [...(module.fields ?? []), ...added] } : module;
      }),
      ...missing.modules,
    ],
    dashboardWidgets: [...config.dashboardWidgets, ...missing.widgets],
  };
  return { config: next, missing };
}

/**
 * Yakka/ko‘plik nom ("Kurs"/"Kurslar", "Bemor"/"Bemorlar"). Sahifa sarlavhalari,
 * "Yangi …" tugmalari va toastlar shu yerdan oladi — menyu nomi bilan janjal bo'lmasligi uchun.
 */
export function coreTerm(
  id: string | null | undefined,
  key: CoreKey,
): { one: string; many: string } {
  const preset = id ? PRESETS[id] : undefined;
  return {
    one: preset?.singles?.[key] ?? CORE_SINGLES[key],
    many: preset?.labels?.[key] ?? CORE_ITEMS[key].label,
  };
}

/**
 * Klublarning belgisi — `allowedRoutes` faqat ularda bor: menyuda faqat 4 bo'lim,
 * yadro CRM bo'limlari umuman ochilmaydi.
 */
export function isClubPreset(id: string | null | undefined): boolean {
  return Boolean(id ? PRESETS[id]?.allowedRoutes : false);
}

/**
 * Qabul/bron band qilinadigan narsa: salon va klinikada bu xizmat, klubda esa
 * qurilma yoki stol (`services` katalogi klubda «Qurilmalar va stollar» deb yuritiladi).
 */
export function serviceTermsForPreset(id: string | null | undefined): { one: string; many: string } {
  return isClubPreset(id)
    ? { one: "Qurilma", many: "Qurilmalar va stollar" }
    : { one: "Xizmat", many: "Xizmatlar" };
}

/** All core terms of a preset at once, so a page calls the resolver once. */
export function termsForPreset(
  id: string | null | undefined,
): Record<CoreKey, { one: string; many: string }> {
  const keys = Object.keys(CORE_ITEMS) as CoreKey[];
  return Object.fromEntries(keys.map((key) => [key, coreTerm(id, key)])) as Record<
    CoreKey,
    { one: string; many: string }
  >;
}

export function menuForPreset(id: string): PresetMenuItem[] {
  const preset = PRESETS[id];
  if (!preset) return [];
  const hidden = hiddenRoutesForPreset(id);
  const label = (key: CoreKey) => preset.labels?.[key] ?? CORE_ITEMS[key].label;
  const withLabel = (key: CoreKey): PresetMenuItem => ({ ...CORE_ITEMS[key], label: label(key) });
  const extras = preset.extraCoreKeys.filter((key) => key !== "pipeline");
  // Klub presetida "Umumiy ko‘rinish" bo'limi yo'q — birinchi bo'lim sahifasi uni almashtiradi.
  const menu: PresetMenuItem[] = preset.homeRoute
    ? []
    : [{ to: "/dashboard", label: "Umumiy ko‘rinish", icon: "dashboard", section: "core" }];
  if (preset.extraCoreKeys.includes("pipeline")) menu.push(withLabel("pipeline"));
  for (const key of LEGACY_CORE_KEYS) menu.push(withLabel(key));
  for (const key of extras) menu.push(withLabel(key));
  menu.push(...preset.industryItems);
  // Preset o'zi sanab o'tgan sahifa (klubdagi Telegram) admin quyirig'ida takrorlanmaydi.
  const listed = new Set(menu.map((item) => item.to));
  for (const item of ADMIN_TAIL) if (!listed.has(item.to)) menu.push(item);
  return menu.filter((item) => !hidden.has(item.to));
}

/** Workflow sets a preset runs on — pipeline stages plus booking statuses. */
export function workflowForPreset(id: string): {
  bookingType: BookingType;
  bookingLabel: string;
  pipelineStages: string[];
  appointmentStatuses: readonly AppointmentStatus[];
} {
  const preset = presetForId(id) ?? UNIVERSAL_PRESET;
  return {
    bookingType: preset.bookingType,
    bookingLabel: preset.bookingLabel ?? BOOKING_TYPE_LABELS[preset.bookingType],
    pipelineStages: crmConfigForPreset(preset.id).pipelineStages,
    appointmentStatuses: APPOINTMENT_STATUSES,
  };
}
