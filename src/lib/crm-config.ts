/**
 * Universal dynamic CRM engine — client-safe types + industry presets.
 * CRM UI is rendered from CrmConfigData; industries only seed the initial
 * configuration. One exception: lib/dental.ts gives the odontogramma module a
 * dedicated chart view on top of the same record storage.
 */

import { TOOTH_CONDITIONS } from "./dental";

export type CrmFieldType =
  | "text"
  | "phone"
  | "number"
  | "money"
  | "date"
  | "time"
  | "select"
  | "textarea"
  | "relation"
  | "file";

/** Core tables a dynamic CRM module can be backed by (see CrmModule.table). */
export type CrmBackedTable = "payments" | "appointments";

/** Relation target: a core table (see CORE_RELATION_TARGETS) or a dynamic module key. */
export interface CrmField {
  key: string;
  label: string;
  type: CrmFieldType;
  required?: boolean;
  options?: string[];
  targetModule?: string;
}

/** Relation values are stored as data[key] = display name, data[key + "_id"] = record id. */
export function relationIdKey(fieldKey: string): string {
  return `${fieldKey}_id`;
}

/**
 * Relation maydonlari yoki shu yadro jadvallariga, yoki biznesning o'z modullariga
 * bog'lanadi. Shifokor/usta/xodim — `employees` jadvalidagi obyekt, CRM moduli emas.
 */
export const CORE_RELATION_TARGETS = ["customers", "employees"] as const;

export function isCoreRelationTarget(target: string): boolean {
  return (CORE_RELATION_TARGETS as readonly string[]).includes(target);
}

/** Legacy dashboard routes a module can map onto (existing functionality, kept). */
export type CrmModuleLink =
  | "/dashboard/customers"
  | "/dashboard/orders"
  | "/dashboard/inventory"
  | "/dashboard/products"
  | "/dashboard/attendance"
  | "/dashboard/services"
  | "/dashboard/employees"
  | "/dashboard/appointments"
  | "/dashboard/payments";

export interface CrmModule {
  key: string;
  label: string;
  icon?: string;
  /** Universal module rendered from crm_records when true/absent. */
  link?: CrmModuleLink;
  /** Marks modules whose records live on the pipeline board. */
  pipeline?: boolean;
  /**
   * When set, the module's rows are stored in this core table instead of crm_records, so
   * the legacy page (To‘lovlar / Qabul va bron), the dashboard KPIs and the public booking
   * page all read and write the very same record.
   */
  table?: CrmBackedTable;
  fields?: CrmField[];
  /**
   * Field whose value names the record. Needed when the first field is a
   * back-reference (e.g. a car's owner) and the record's own identity comes later.
   */
  titleField?: string;
}

export interface CrmWidget {
  key: string;
  label: string;
  kind:
    | "module_count"
    | "module_count_today"
    | "field_sum"
    | "legacy_today_revenue"
    | "legacy_today_orders"
    | "legacy_today_leads"
    | "legacy_hot_leads"
    | "legacy_handoffs";
  moduleKey?: string;
  fieldKey?: string;
  where?: { field: string; value: string };
}

export interface CrmConfigData {
  modules: CrmModule[];
  pipelineStages: string[];
  terminology: Record<string, string>;
  dashboardWidgets: CrmWidget[];
  automations: string[];
  /** Registry id from lib/presets.ts. Absent in configs saved before the registry existed. */
  presetId?: string;
}

export interface CrmConfig {
  industry: string;
  businessDescription: string | null;
  config: CrmConfigData;
}

export interface IndustryOption {
  key: string;
  emoji: string;
  label: string;
}

/** Industry options live in lib/presets.ts (INDUSTRIES) — the registry owns preset identity. */

function moneyField(key: string, label: string, required = false): CrmField {
  return { key, label, type: "money", required };
}
function textField(key: string, label: string, required = true): CrmField {
  return { key, label, type: "text", required };
}
function phoneField(): CrmField {
  return { key: "telefon", label: "Telefon", type: "phone" };
}
function dateField(key: string, label: string, required = false): CrmField {
  return { key, label, type: "date", required };
}
function timeField(key: string, label: string, required = false): CrmField {
  return { key, label, type: "time", required };
}
function selectField(key: string, label: string, options: string[], required = false): CrmField {
  return { key, label, type: "select", options, required };
}
function noteField(): CrmField {
  return { key: "izoh", label: "Izoh", type: "textarea" };
}
/** Files live in the private `crm_attachments` bucket; the stored value is the object path. */
function fileField(key: string, label: string): CrmField {
  return { key, label, type: "file" };
}
function paymentModule(label = "To‘lovlar", link?: CrmModuleLink): CrmModule {
  return {
    key: "tolovlar",
    label,
    ...(link ? { link } : {}),
    table: "payments",
    fields: [
      textField("kim", "Kim uchun"),
      moneyField("summa", "Summa", true),
      dateField("sana", "Sana"),
      selectField("holat", "Holat", ["To‘landi", "To‘lanmagan", "Qisman"]),
      selectField("tur", "To‘lov turi", ["Naqd", "Karta", "Pul o‘tkazma", "Boshqa"]),
      noteField(),
    ],
  };
}

interface PresetInput {
  modules: CrmModule[];
  pipelineStages: string[];
  terminology: Record<string, string>;
  dashboardWidgets: CrmWidget[];
  automations?: string[];
}

const W_TODAY_REVENUE: CrmWidget = { key: "tushum", label: "Bugungi tushum", kind: "legacy_today_revenue" };
const W_TODAY_ORDERS: CrmWidget = { key: "buyurtmalar", label: "Bugungi buyurtmalar", kind: "legacy_today_orders" };
const W_HANDOFFS: CrmWidget = { key: "attention", label: "E'tibor kutilmoqda", kind: "legacy_handoffs" };

function defaultWidgets(extra: CrmWidget[]): CrmWidget[] {
  return [...extra, W_TODAY_REVENUE, W_HANDOFFS];
}

function preset(p: PresetInput): CrmConfigData {
  return {
    modules: p.modules,
    pipelineStages: p.pipelineStages,
    terminology: p.terminology,
    dashboardWidgets: defaultWidgets(p.dashboardWidgets),
    automations: p.automations ?? [],
  };
}

export const GENERIC_PIPELINE = [
  "Yangi murojaat",
  "Muzokara",
  "Kelishildi",
  "To‘lov",
  "Bajarilmoqda",
  "Yakunlandi",
];

const GENERIC_MODULES: CrmModule[] = [
  { key: "mijozlar", label: "Mijozlar", icon: "users", link: "/dashboard/customers" },
  { key: "buyurtmalar", label: "Buyurtmalar", icon: "cart", link: "/dashboard/orders" },
  { key: "mahsulotlar", label: "Mahsulotlar / Xizmatlar", icon: "package", link: "/dashboard/products" },
  paymentModule(),
];

export const GENERIC_PRESET: CrmConfigData = preset({
  modules: GENERIC_MODULES,
  pipelineStages: GENERIC_PIPELINE,
  terminology: { customer: "Mijoz", lead: "Murojaat", order: "Buyurtma" },
  dashboardWidgets: [W_TODAY_ORDERS],
});

const BASE_PRESETS: Record<string, CrmConfigData> = {
  stomatologiya: preset({
    modules: [
      { key: "bemorlar", label: "Bemorlar", icon: "users", link: "/dashboard/customers" },
      {
        key: "qabul",
        label: "Qabul",
        icon: "calendar",
        table: "appointments",
        link: "/dashboard/appointments",
        fields: [
          textField("bemor", "Bemor ismi"),
          phoneField(),
          { key: "xizmat", label: "Xizmat", type: "select", options: ["Konsultatsiya", "Davolash", "Protezlash", "Implantatsiya", "Gigiyena"], required: true },
          textField("shifokor", "Shifokor"),
          dateField("qabul_sanasi", "Qabul sanasi", true),
          timeField("vaqt", "Vaqt", true),
          { key: "tashxis", label: "Tashxis", type: "textarea" },
          moneyField("tolov", "To‘lov"),
          noteField(),
        ],
      },
      {
        key: "shifokorlar",
        label: "Shifokorlar",
        icon: "stethoscope",
        link: "/dashboard/employees",
        fields: [
          textField("ism", "Ism"),
          phoneField(),
          textField("mutaxassislik", "Mutaxassislik"),
          selectField("holat", "Holat", ["Faol", "Ta'tilda"]),
          noteField(),
        ],
      },
      {
        key: "odontogramma",
        label: "Odontogramma",
        icon: "activity",
        fields: [
          textField("bemor", "Bemor"),
          { key: "tish", label: "Tish raqami (FDI)", type: "number", required: true },
          selectField("holat", "Holat", [...TOOTH_CONDITIONS], true),
          textField("tavsiya", "Tavsiya etilgan muolaja", false),
          dateField("sana", "Sana"),
          textField("shifokor", "Shifokor"),
          moneyField("narx", "Narx"),
          noteField(),
        ],
      },
      {
        key: "bemor_kartasi",
        label: "Bemor kartasi",
        icon: "clipboard",
        fields: [
          textField("bemor", "Bemor"),
          dateField("tugilgan_kun", "Tug‘ilgan kun"),
          selectField("qon_guruhi", "Qon guruhi", ["I (0)", "II (A)", "III (B)", "IV (AB)", "Aniqlanmagan"]),
          textField("allergiya", "Allergiya", false),
          { key: "anamnez", label: "Anamnez (surunkali kasalliklar)", type: "textarea" },
          { key: "dorilar", label: "Qabul qilinadigan dorilar", type: "textarea" },
          { key: "ko_rsatilgan", label: "Qo‘shimcha ko‘rsatmalar", type: "textarea" },
          dateField("yangilangan", "Oxirgi yangilanish"),
        ],
      },
      {
        key: "davolash",
        label: "Davolash",
        icon: "activity",
        fields: [
          textField("bemor", "Bemor"),
          textField("xizmat", "Xizmat"),
          textField("tish", "Tish raqami", false),
          dateField("boshlanish", "Boshlanish sanasi"),
          dateField("muddat", "Rejalashtirilgan tugash"),
          selectField("bosqich", "Bosqich", ["Rejalashtirildi", "Davom etmoqda", "Tugadi"], true),
          textField("shifokor", "Shifokor"),
          moneyField("narx", "Narx"),
          moneyField("tolangan", "To‘langan"),
          noteField(),
        ],
      },
      {
        key: "rentgen",
        label: "Rentgen va hujjatlar",
        icon: "file",
        fields: [
          textField("bemor", "Bemor"),
          selectField("turi", "Hujjat turi", ["Rentgen", "KT", "Panorama", "Rasmiy hujjat", "Boshqa"]),
          dateField("sana", "Sana"),
          textField("tashxis", "Izoh / tavsif", false),
          fileField("fayl", "Fayl"),
          textField("shifokor", "Shifokor", false),
          noteField(),
        ],
      },
      paymentModule("To‘lovlar", "/dashboard/payments"),
    ],
    pipelineStages: ["Yangi murojaat", "Konsultatsiya", "Qabul belgilandi", "Davolash", "To‘lov", "Yakunlandi"],
    terminology: { customer: "Bemor", lead: "Murojaat", order: "Qabul" },
    dashboardWidgets: [
      { key: "qabul_bugun", label: "Bugungi qabul", kind: "module_count_today", moduleKey: "qabul" },
      { key: "bemorlar", label: "Bemorlar", kind: "module_count", moduleKey: "bemorlar" },
      { key: "kutilayotgan_tolov", label: "Kutilayotgan to‘lovlar", kind: "module_count", moduleKey: "tolovlar", where: { field: "holat", value: "To‘lanmagan" } },
      { key: "davolash_rejada", label: "Rejadagi davolashlar", kind: "module_count", moduleKey: "davolash", where: { field: "bosqich", value: "Rejalashtirildi" } },
      { key: "davolash_davom", label: "Davom etayotgan davolashlar", kind: "module_count", moduleKey: "davolash", where: { field: "bosqich", value: "Davom etmoqda" } },
    ],
  }),

  oquv: preset({
    modules: [
      { key: "oquvchilar", label: "O‘quvchilar", icon: "users", link: "/dashboard/customers" },
      {
        key: "kurslar",
        label: "Kurslar",
        icon: "book",
        fields: [
          textField("nomi", "Kurs nomi"),
          moneyField("narxi", "Narxi"),
          textField("davomiyligi", "Davomiyligi"),
          textField("oqituvchi", "O‘qituvchi"),
          noteField(),
        ],
      },
      {
        key: "guruhlar",
        label: "Guruhlar",
        icon: "layers",
        fields: [
          textField("nomi", "Guruh nomi"),
          textField("kurs", "Kurs"),
          textField("oqituvchi", "O‘qituvchi"),
          dateField("boshlanish", "Boshlanish sanasi"),
          selectField("holat", "Holat", ["To‘planyapti", "Faol", "Tugadi"], true),
        ],
      },
      {
        key: "oqituvchilar",
        label: "O‘qituvchilar",
        icon: "user",
        fields: [textField("ism", "Ism"), phoneField(), textField("fan", "Fan"), noteField()],
      },
      paymentModule(),
      { key: "davomat", label: "Davomat", icon: "check", link: "/dashboard/attendance" },
    ],
    pipelineStages: ["Yangi lead", "Aloqa qilindi", "Sinov darsi", "Ro‘yxatdan o‘tdi", "O‘qishni boshladi", "Faol", "Tugatdi"],
    terminology: { customer: "O‘quvchi", lead: "Lead", order: "Ro‘yxatdan o‘tish" },
    dashboardWidgets: [
      { key: "oquvchilar", label: "Faol o‘quvchilar", kind: "module_count", moduleKey: "oquvchilar" },
      { key: "guruhlar", label: "Guruhlar", kind: "module_count", moduleKey: "guruhlar" },
      { key: "tolanmagan", label: "To‘lanmagan to‘lovlar", kind: "field_sum", moduleKey: "tolovlar", fieldKey: "summa", where: { field: "holat", value: "To‘lanmagan" } },
      { key: "davomat_bugun", label: "Bugungi davomat", kind: "module_count_today", moduleKey: "davomat" },
    ],
  }),

  ecommerce: preset({
    modules: [
      { key: "buyurtmalar", label: "Buyurtmalar", icon: "cart", link: "/dashboard/orders", pipeline: true },
      { key: "mijozlar", label: "Mijozlar", icon: "users", link: "/dashboard/customers" },
      { key: "mahsulotlar", label: "Mahsulotlar", icon: "package", link: "/dashboard/products" },
      { key: "ombor", label: "Ombor", icon: "boxes", link: "/dashboard/inventory" },
      paymentModule(),
    ],
    pipelineStages: ["Yangi buyurtma", "Tasdiqlandi", "Tayyorlanmoqda", "Yetkazilmoqda", "Yetkazildi", "Yakunlandi"],
    terminology: { customer: "Mijoz", lead: "Buyurtma", order: "Buyurtma" },
    dashboardWidgets: [W_TODAY_ORDERS],
  }),

  avtoservis: preset({
    modules: [
      { key: "mijozlar", label: "Mijozlar", icon: "users", link: "/dashboard/customers" },
      {
        key: "avtomobillar",
        label: "Avtomobillar",
        icon: "car",
        fields: [
          textField("mijoz", "Mijoz"),
          textField("marka", "Marka / model"),
          textField("raqami", "Davlat raqami"),
          { key: "yil", label: "Yil", type: "number" },
          noteField(),
        ],
      },
      {
        key: "servis",
        label: "Servis buyurtmalari",
        icon: "wrench",
        pipeline: true,
        fields: [
          textField("mijoz", "Mijoz"),
          textField("avtomobil", "Avtomobil"),
          { key: "muammo", label: "Muammo", type: "textarea" },
          textField("usta", "Usta"),
          moneyField("narx", "Narx"),
          selectField("holat", "Holat", ["Qabul qilindi", "Ishlanmoqda", "Tayyor", "Olib ketildi"], true),
        ],
      },
      {
        key: "ustalar",
        label: "Ustalar",
        icon: "user",
        link: "/dashboard/employees",
        fields: [textField("ism", "Ism"), phoneField(), textField("mutaxassislik", "Mutaxassislik"), noteField()],
      },
      paymentModule("To‘lovlar", "/dashboard/payments"),
    ],
    pipelineStages: ["Yangi murojaat", "Diagnostika", "Ta'mirlash", "Tayyor", "To‘lov", "Yakunlandi"],
    terminology: { customer: "Mijoz", lead: "Murojaat", order: "Servis buyurtmasi" },
    dashboardWidgets: [
      { key: "servis", label: "Servis buyurtmalari", kind: "module_count", moduleKey: "servis" },
      { key: "avtomobillar", label: "Avtomobillar", kind: "module_count", moduleKey: "avtomobillar" },
    ],
  }),

  kochmas_mulk: preset({
    modules: [
      { key: "mijozlar", label: "Mijozlar", icon: "users", link: "/dashboard/customers" },
      {
        key: "obyekt",
        label: "Ko‘chmas mulklar",
        icon: "home",
        fields: [
          textField("nomi", "Nomi"),
          selectField("turi", "Turi", ["Kvartira", "Uy", "Yer", "Tijorat"], true),
          textField("manzil", "Manzil"),
          moneyField("narx", "Narx"),
          { key: "maydon", label: "Maydon (m²)", type: "number" },
          noteField(),
        ],
      },
      {
        key: "korishlar",
        label: "Ko‘rishlar",
        icon: "eye",
        table: "appointments",
        fields: [
          textField("mijoz", "Mijoz"),
          textField("obyekt", "Ob'ekt"),
          dateField("sana", "Sana", true),
          timeField("vaqt", "Vaqt", true),
          selectField("holat", "Holat", ["Rejalashtirildi", "Bo‘lib o‘tdi", "Bekor qilindi"], true),
          noteField(),
        ],
      },
      {
        key: "bitimlar",
        label: "Bitimlar",
        icon: "handshake",
        fields: [
          textField("mijoz", "Mijoz"),
          textField("obyekt", "Ob'ekt"),
          moneyField("summa", "Summa"),
          selectField("holat", "Holat", ["Muzokarada", "Imzolandi", "Bekor"], true),
          noteField(),
        ],
      },
    ],
    pipelineStages: ["Yangi lead", "Aloqa", "Talab aniqlash", "Ob'ekt ko‘rsatildi", "Muzokara", "Bitim", "Yakunlandi"],
    terminology: { customer: "Mijoz", lead: "Lead", order: "Bitim" },
    dashboardWidgets: [
      { key: "obyekt", label: "Ko‘chmas mulklar", kind: "module_count", moduleKey: "obyekt" },
      { key: "korishlar", label: "Ko‘rishlar", kind: "module_count", moduleKey: "korishlar" },
      { key: "bitimlar", label: "Bitimlar", kind: "module_count", moduleKey: "bitimlar" },
    ],
  }),

  beauty: preset({
    // Salon obyektlarining hammasi yadro jadvallarida: mijoz — customers, qabul —
    // appointments, xizmat — services, usta — employees, to‘lov — payments. Modul
    // sahifalari presetda yashirilgan (hiddenModuleKeys), link esa to‘g‘ridan-to‘g‘ri
    // kirgan foydalanuvchini haqiqiy sahifaga olib chiqadi.
    modules: [
      { key: "mijozlar", label: "Mijozlar", icon: "users", link: "/dashboard/customers" },
      {
        key: "qabul",
        label: "Qabul",
        icon: "calendar",
        table: "appointments",
        link: "/dashboard/appointments",
        fields: [
          textField("mijoz", "Mijoz ismi"),
          phoneField(),
          textField("xizmat", "Xizmat"),
          textField("usta", "Usta"),
          dateField("sana", "Qabul sanasi", true),
          timeField("vaqt", "Vaqt", true),
          { key: "davomiylik", label: "Davomiyligi (daqiqa)", type: "number" },
          moneyField("tolov", "To‘lov"),
          noteField(),
        ],
      },
      {
        key: "xizmatlar",
        label: "Xizmatlar",
        icon: "package",
        link: "/dashboard/services",
        fields: [
          textField("nomi", "Xizmat nomi"),
          moneyField("narxi", "Narxi"),
          { key: "davomiylik", label: "Davomiyligi (daqiqa)", type: "number" },
        ],
      },
      {
        key: "ustalar",
        label: "Ustalar",
        icon: "user",
        link: "/dashboard/employees",
        fields: [textField("ism", "Ism"), phoneField(), textField("mutaxassislik", "Mutaxassislik"), noteField()],
      },
      paymentModule("To‘lovlar", "/dashboard/payments"),
    ],
    pipelineStages: ["Yangi murojaat", "Qabul belgilandi", "Xizmat ko‘rsatildi", "To‘lov", "Yakunlandi"],
    terminology: { customer: "Mijoz", lead: "Murojaat", order: "Qabul" },
    dashboardWidgets: [
      { key: "qabul_bugun", label: "Bugungi qabul", kind: "module_count_today", moduleKey: "qabul" },
      { key: "xizmatlar", label: "Xizmatlar", kind: "module_count", moduleKey: "xizmatlar" },
    ],
  }),

  qurilish: preset({
    modules: [
      { key: "mijozlar", label: "Mijozlar", icon: "users", link: "/dashboard/customers" },
      {
        key: "loyihalar",
        label: "Loyihalar",
        icon: "building",
        pipeline: true,
        fields: [
          textField("nomi", "Loyiha nomi"),
          textField("mijoz", "Mijoz"),
          moneyField("byudjet", "Byudjet"),
          dateField("boshlanish", "Boshlanish sanasi"),
          selectField("bosqich", "Bosqich", ["Rejalashtirildi", "Ishlanmoqda", "Tugadi"], true),
          noteField(),
        ],
      },
      {
        key: "pudratchilar",
        label: "Pudratchilar",
        icon: "user",
        fields: [textField("ism", "Ism"), phoneField(), textField("mutaxassislik", "Mutaxassislik"), noteField()],
      },
      paymentModule(),
    ],
    pipelineStages: ["Yangi murojaat", "Smeta", "Shartnoma", "Ishlanmoqda", "To‘lov", "Yakunlandi"],
    terminology: { customer: "Mijoz", lead: "Murojaat", order: "Loyiha" },
    dashboardWidgets: [
      { key: "loyihalar", label: "Loyihalar", kind: "module_count", moduleKey: "loyihalar" },
    ],
  }),

  xizmat: preset({
    modules: [
      { key: "mijozlar", label: "Mijozlar", icon: "users", link: "/dashboard/customers" },
      {
        key: "xizmatlar",
        label: "Xizmatlar",
        icon: "package",
        link: "/dashboard/services",
        fields: [
          textField("nomi", "Xizmat nomi"),
          moneyField("narxi", "Narxi"),
          { key: "davomiylik", label: "Davomiyligi", type: "text" },
          noteField(),
        ],
      },
      paymentModule("To‘lovlar", "/dashboard/payments"),
    ],
    pipelineStages: GENERIC_PIPELINE,
    terminology: { customer: "Mijoz", lead: "Murojaat", order: "Buyurtma" },
    dashboardWidgets: [{ key: "xizmatlar", label: "Xizmatlar", kind: "module_count", moduleKey: "xizmatlar" }],
  }),

  smm: preset({
    modules: [
      { key: "mijozlar", label: "Mijozlar", icon: "users", link: "/dashboard/customers" },
      {
        key: "loyihalar",
        label: "Proyektlar",
        icon: "building",
        pipeline: true,
        fields: [
          textField("nomi", "Proyekt nomi"),
          textField("mijoz", "Mijoz"),
          moneyField("narx", "Narx (oylik)"),
          selectField("paket", "Paket", ["SMM", "Targeting", "Kontent", "To‘liq paket"], true),
          selectField("holat", "Holat", ["Boshlanmagan", "Ishlanmoqda", "Tugadi"], true),
          noteField(),
        ],
      },
      paymentModule(),
    ],
    pipelineStages: ["Yangi murojaat", "Prezentatsiya", "Shartnoma", "Ishlanmoqda", "To‘lov", "Yakunlandi"],
    terminology: { customer: "Mijoz", lead: "Murojaat", order: "Proyekt" },
    dashboardWidgets: [{ key: "loyihalar", label: "Proyektlar", kind: "module_count", moduleKey: "loyihalar" }],
  }),

  klinika: preset({
    modules: [
      { key: "bemorlar", label: "Bemorlar", icon: "users", link: "/dashboard/customers" },
      {
        key: "qabul",
        label: "Qabul",
        icon: "calendar",
        table: "appointments",
        link: "/dashboard/appointments",
        fields: [
          textField("bemor", "Bemor ismi"),
          phoneField(),
          textField("bolim", "Bo‘lim"),
          textField("shifokor", "Shifokor"),
          dateField("sana", "Qabul sanasi", true),
          timeField("vaqt", "Vaqt", true),
          selectField("holat", "Holat", ["Navbatda", "Qabulda", "Yakunlandi", "Kelmadi"], true),
          textField("xona", "Xona / kabinet", false),
          moneyField("tolov", "To‘lov"),
          noteField(),
        ],
      },
      {
        key: "bolimlar",
        label: "Bo‘limlar",
        icon: "building",
        fields: [
          textField("nomi", "Bo‘lim nomi"),
          textField("mudir", "Bo‘lim mudiri"),
          textField("xonalar", "Kabinetlar soni", false),
          selectField("holat", "Holat", ["Faol", "Vaqtinchalik yopiq"]),
          noteField(),
        ],
      },
      {
        key: "shifokorlar",
        label: "Shifokorlar",
        icon: "stethoscope",
        link: "/dashboard/employees",
        fields: [
          textField("ism", "Ism"),
          phoneField(),
          textField("mutaxassislik", "Mutaxassislik"),
          textField("bolim", "Bo‘lim"),
          selectField("malaka", "Malaka toifasi", ["Yuqori", "Birinchi", "Ikkinchi", "Toifasiz"]),
          selectField("holat", "Holat", ["Faol", "Ta'tilda"]),
          noteField(),
        ],
      },
      {
        key: "tibbiy_karta",
        label: "Tibbiy karta",
        icon: "clipboard",
        fields: [
          textField("bemor", "Bemor"),
          dateField("tugilgan_kun", "Tug‘ilgan kun"),
          selectField("jinsi", "Jinsi", ["Ayol", "Erkak", "Ko‘rsatilmagan"]),
          selectField("qon_guruhi", "Qon guruhi", ["I (0)", "II (A)", "III (B)", "IV (AB)", "Aniqlanmagan"]),
          textField("allergiya", "Allergiya", false),
          { key: "anamnez", label: "Anamnez (surunkali kasalliklar)", type: "textarea" },
          { key: "dorilar", label: "Qabul qilinadigan dorilar", type: "textarea" },
          { key: "operatsiyalar", label: "O‘tkazilgan operatsiyalar", type: "textarea" },
          dateField("yangilangan", "Oxirgi yangilanish"),
          noteField(),
        ],
      },
      {
        key: "koriklar",
        label: "Ko‘rik va tashxis",
        icon: "stethoscope",
        fields: [
          textField("bemor", "Bemor"),
          textField("shifokor", "Shifokor"),
          dateField("sana", "Ko‘rik sanasi"),
          { key: "shikoyat", label: "Shikoyat", type: "textarea" },
          { key: "tekshiruv", label: "Obyektiv tekshiruv", type: "textarea" },
          textField("tashxis", "Tashxis"),
          textField("mkx_kodi", "MKX kodi", false),
          { key: "tavsiya", label: "Davolash tavsiyasi", type: "textarea" },
          dateField("qayta_korik", "Qayta ko‘rik sanasi"),
          textField("yollanma", "Yo‘llanma (boshqa mutaxassis)", false),
          moneyField("narx", "Ko‘rik narxi"),
          noteField(),
        ],
      },
      {
        key: "tahlillar",
        label: "Tahlillar",
        icon: "flask",
        fields: [
          textField("bemor", "Bemor"),
          textField("turi", "Tahlil nomi"),
          selectField("holat", "Holat", ["Topshirildi", "Natija keldi", "Bekor qilindi"], true),
          dateField("sana", "Topshirilgan sana"),
          dateField("natija_sana", "Natija sanasi"),
          { key: "natija", label: "Natija (ko‘rsatkichlar)", type: "textarea" },
          textField("yo_nalgan", "Yo‘naltirgan shifokor"),
          moneyField("narx", "Narx"),
          fileField("fayl", "Natija fayli"),
          noteField(),
        ],
      },
      {
        key: "davolash_rejasi",
        label: "Davolash rejasi",
        icon: "check",
        fields: [
          textField("bemor", "Bemor"),
          textField("shifokor", "Shifokor"),
          textField("maqsad", "Davolash maqsadi"),
          selectField("bosqich", "Bosqich", ["Rejalashtirildi", "Davom etmoqda", "Yakunlandi"], true),
          dateField("boshlanish", "Boshlanish sanasi"),
          dateField("muddat", "Rejalashtirilgan tugash"),
          { key: "protseduralar", label: "Protseduralar ro‘yxati", type: "textarea" },
          moneyField("narx", "Reja narxi"),
          moneyField("tolangan", "To‘langan"),
          noteField(),
        ],
      },
      {
        key: "hujjatlar",
        label: "Tibbiy hujjatlar",
        icon: "file",
        fields: [
          textField("bemor", "Bemor"),
          selectField("turi", "Hujjat turi", ["Yo‘llanma", "Ma'lumotnoma", "Rozilik", "Rentgen", "Tahlil natijasi", "Boshqa"], true),
          dateField("sana", "Sana"),
          textField("tavsif", "Izoh / tavsif", false),
          fileField("fayl", "Fayl"),
          textField("shifokor", "Shifokor", false),
          noteField(),
        ],
      },
      paymentModule("To‘lovlar", "/dashboard/payments"),
    ],
    pipelineStages: ["Yangi murojaat", "Qabul belgilandi", "Ko‘rik", "Davolash", "To‘lov", "Yakunlandi"],
    terminology: { customer: "Bemor", lead: "Murojaat", order: "Qabul" },
    dashboardWidgets: [
      { key: "qabul_bugun", label: "Bugungi qabul", kind: "module_count_today", moduleKey: "qabul" },
      {
        key: "qabul_navbat",
        label: "Navbatda kutayotganlar",
        kind: "module_count",
        moduleKey: "qabul",
        where: { field: "holat", value: "Navbatda" },
      },
      {
        key: "tahlillar_kutilmoqda",
        label: "Natijasi kutilayotgan tahlillar",
        kind: "module_count",
        moduleKey: "tahlillar",
        where: { field: "holat", value: "Topshirildi" },
      },
      { key: "bemorlar", label: "Bemorlar", kind: "module_count", moduleKey: "bemorlar" },
    ],
  }),

  // Klub sohalari: CRM modullari umuman yo'q. Sessiya vaqtini tashqi hisoblagichi
  // sanaydi, KetaOne dasturni tarqatadi, Telegram'ni ulaydi va bronni boshqaradi.
  playstation: preset({
    modules: [],
    pipelineStages: GENERIC_PIPELINE,
    terminology: { customer: "Mijoz", lead: "Murojaat", order: "Bron" },
    dashboardWidgets: [],
  }),

  bilyard: preset({
    modules: [],
    pipelineStages: GENERIC_PIPELINE,
    terminology: { customer: "Mijoz", lead: "Murojaat", order: "Bron" },
    dashboardWidgets: [],
  }),
};

/** Which preset fields link to other modules, per industry → module → field → target. */
export const RELATION_MAP: Record<string, Record<string, Record<string, string>>> = {
  // Shifokor — yadro obyekti (employees jadvali: lavozim, jadval, ta'til, komissiya),
  // shuning uchun tibbiy modullardagi "shifokor" maydoni xodimlarga bog'lanadi.
  stomatologiya: {
    qabul: { bemor: "customers", shifokor: "employees" },
    davolash: { bemor: "customers", shifokor: "employees" },
    odontogramma: { bemor: "customers", shifokor: "employees" },
    bemor_kartasi: { bemor: "customers" },
    rentgen: { bemor: "customers", shifokor: "employees" },
    tolovlar: { kim: "customers" },
  },
  klinika: {
    qabul: { bemor: "customers", shifokor: "employees", bolim: "bolimlar" },
    bolimlar: { mudir: "employees" },
    tibbiy_karta: { bemor: "customers" },
    koriklar: { bemor: "customers", shifokor: "employees" },
    tahlillar: { bemor: "customers", yo_nalgan: "employees" },
    davolash_rejasi: { bemor: "customers", shifokor: "employees" },
    hujjatlar: { bemor: "customers", shifokor: "employees" },
    tolovlar: { kim: "customers" },
  },
  oquv: {
    kurslar: { oqituvchi: "oqituvchilar" },
    guruhlar: { kurs: "kurslar", oqituvchi: "oqituvchilar" },
    davomat: { oquvchi: "customers", guruh: "guruhlar" },
    tolovlar: { kim: "customers" },
  },
  avtoservis: {
    avtomobillar: { mijoz: "customers" },
    servis: { mijoz: "customers", avtomobil: "avtomobillar", usta: "employees" },
    tolovlar: { kim: "customers" },
  },
  kochmas_mulk: {
    korishlar: { mijoz: "customers", obyekt: "obyekt" },
    bitimlar: { mijoz: "customers", obyekt: "obyekt" },
  },
  beauty: { qabul: { mijoz: "customers", xizmat: "xizmatlar", usta: "ustalar" }, tolovlar: { kim: "customers" } },
  qurilish: { loyihalar: { mijoz: "customers" }, tolovlar: { kim: "customers" } },
  smm: { loyihalar: { mijoz: "customers" }, tolovlar: { kim: "customers" } },
  xizmat: { tolovlar: { kim: "customers" } },
};

/**
 * Records are named after their first field, but when that field is a
 * back-reference (a car's owner) the list loses the record's own identity.
 * Maps an industry module to the field that names it.
 */
export const TITLE_FIELD_MAP: Record<string, Record<string, string>> = {
  avtoservis: { avtomobillar: "marka", servis: "avtomobil" },
};

/**
 * Modules that store rows in a core table instead of crm_records (adapters live in
 * lib/crm-backed.ts). Stamped onto saved configs at read time, so tenants that onboarded
 * before this switch start writing to the real payments/appointments tables immediately.
 */
export const BACKED_MODULE_TABLES: Record<string, CrmBackedTable> = {
  tolovlar: "payments",
  qabul: "appointments",
  korishlar: "appointments",
};

/** Yuqoridagi bo'limdan olib tashlangan modullar — saqlangan konfiguratsiyalardan ham tushib qoladi. */
export const RETIRED_MODULE_KEYS = ["suhbatlar", "murojaatlar", "leadlar"];

/**
 * Modullar yadro sahifasiga ko'chgan (Davomat → /dashboard/attendance).
 * Saqlangan konfiguratsiyalarda ham havola o'qilish vaqtda qo'yiladi, aks holda
 * eski bizneslar menuyda yana crm_records sahifasiga qaytadi.
 */
export const MODULE_LINK_UPGRADES: Partial<Record<string, CrmModuleLink>> = {
  davomat: "/dashboard/attendance",
};

/** Sahifasi bo'lmagan (yoki butunlay o'chirilgan) bo'limga havola qiluvchi modullar. */
const RETIRED_LINKS: string[] = ["/dashboard/conversations", "/dashboard/leads"];

/** Murojaatlar bo'limi bilan birga ketadigan dashboard vidjetlari. */
const RETIRED_WIDGET_KEYS: string[] = ["murojaatlar"];
const RETIRED_WIDGET_KINDS: string[] = ["legacy_today_leads", "legacy_hot_leads"];

/** Turns mapped text fields into relation fields; also upgrades saved configs. */
export function applyRelations(industry: string | null | undefined, config: CrmConfigData): CrmConfigData {
  // Saved configs predate the retire of the sales-agent "operator" wording.
  const dashboardWidgets = config.dashboardWidgets
    .map((widget) =>
      widget.key === "operator" ? { ...widget, key: "attention", label: "E'tibor kutilmoqda" } : widget,
    )
    // "Murojaatlar" bo'limi yo'q — saqlangan konfiguratsiyalarda ham vidjet qolmasin.
    .filter((widget) => !RETIRED_WIDGET_KEYS.includes(widget.key) && !RETIRED_WIDGET_KINDS.includes(widget.kind));

  const industryKey = industry ?? "";
  const map = RELATION_MAP[industryKey];
  const titleMap = TITLE_FIELD_MAP[industryKey];
  const modules = config.modules
    // "Suhbatlar" bo'limi sahifasi o'chirilgan — saqlangan konfiguratsiyalarda ham qolmasin.
    .filter(
      (m) =>
        !RETIRED_MODULE_KEYS.includes(m.key) && !(m.link && RETIRED_LINKS.includes(m.link as string)),
    )
    .map((m) => {
      if (!m.link && !m.table) {
        const upgrade = MODULE_LINK_UPGRADES[m.key];
        if (upgrade) return { ...m, link: upgrade };
      }
      const table = BACKED_MODULE_TABLES[m.key];
      if (!table || m.link) return m;
      // Bosqich crm_records.stage'ni boshqaradi — yadro jadvalida o'z holat ustuni bor.
      return { ...m, table, pipeline: false };
    });
  if (!map && !titleMap) return { ...config, dashboardWidgets, modules };
  const keys = new Set(modules.map((m) => m.key));
  return {
    ...config,
    dashboardWidgets,
    modules: modules.map((m) => {
      const fm = map?.[m.key];
      const titleField = titleMap?.[m.key];
      if (!titleField && (!fm || !m.fields)) return m;
      return {
        ...m,
        ...(titleField ? { titleField } : {}),
        fields: (m.fields ?? []).map((f) => {
          const target = fm?.[f.key];
          if (!target || f.type === "relation") return f;
          if (!isCoreRelationTarget(target) && !keys.has(target)) return f;
          return { ...f, type: "relation" as const, targetModule: target };
        }),
      };
    }),
  };
}

export const INDUSTRY_PRESETS: Record<string, CrmConfigData> = Object.fromEntries(
  Object.entries(BASE_PRESETS).map(([k, v]) => [k, applyRelations(k, v)]),
);

/** Preset for a chosen industry ("boshqa" → generic, refined by AI). */
export function presetForIndustry(industryKey: string): CrmConfigData {
  return INDUSTRY_PRESETS[industryKey] ?? GENERIC_PRESET;
}
