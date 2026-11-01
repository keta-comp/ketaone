/** Client-safe constants for the CRM core (customers, orders, payments, tasks). */

import { coreTerm, resolvePresetId } from "./presets";

export const CUSTOMER_STATUSES = ["active", "lead", "vip", "inactive"] as const;
export const CUSTOMER_SOURCES = [
  "website",
  "instagram",
  "phone",
  "referral",
  "manual",
  "other",
] as const;
export const PAYMENT_METHODS = ["cash", "card", "transfer", "online", "other"] as const;
export const PAYMENT_RECORD_STATUSES = ["pending", "paid", "partial", "refunded"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_STATUSES = ["pending", "in_progress", "completed"] as const;

export const CRM_LABELS: Record<string, string> = {
  // customer status
  active: "Faol",
  lead: "Potensial",
  vip: "VIP",
  inactive: "Nofaol",
  // sources
  website: "Veb-sayt",
  instagram: "Instagram",
  phone: "Telefon",
  referral: "Tavsiya",
  manual: "Qo‘lda",
  other: "Boshqa",
  telegram: "Telegram",
  // payment method
  cash: "Naqd",
  card: "Karta",
  transfer: "O‘tkazma",
  online: "Onlayn",
  // payment / task status
  pending: "Kutilmoqda",
  in_progress: "Jarayonda",
  completed: "Bajarildi",
  // priority
  low: "Past",
  medium: "O‘rta",
  high: "Yuqori",
};

export function crmLabel(value: string | null | undefined) {
  const key = (value ?? "").toLowerCase();
  return CRM_LABELS[key] ?? key.replace(/_/g, " ");
}

/** Quick "+ Yangi" actions, tuned per industry but always backed by the same core entities. */
export type QuickActionKey = "customer" | "order" | "payment" | "task";

/**
 * Har bir tezkor amal qaysi bo'limga yozadi — preset o'sha bo'limni yashirsa
 * (klublar), amal ham taklif qilinmaydi.
 */
export const QUICK_ACTION_SECTIONS: Record<QuickActionKey, string> = {
  customer: "/dashboard/customers",
  order: "/dashboard/orders",
  payment: "/dashboard/payments",
  task: "/dashboard/tasks",
};

export function quickActionLabels(industry: string | null | undefined): Record<QuickActionKey, string> {
  const presetId = resolvePresetId(industry);
  return {
    customer: coreTerm(presetId, "customers").one,
    order: coreTerm(presetId, "orders").one,
    payment: coreTerm(presetId, "payments").one,
    task: coreTerm(presetId, "tasks").one,
  };
}

export function dateRangeFromPreset(preset: string): { from: string; to: string } {
  const now = new Date();
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);

  switch (preset) {
    case "today":
      break;
    case "7d":
      start.setUTCDate(start.getUTCDate() - 6);
      break;
    case "30d":
      start.setUTCDate(start.getUTCDate() - 29);
      break;
    case "month":
      start.setUTCDate(1);
      break;
    case "last_month": {
      start.setUTCDate(1);
      start.setUTCMonth(start.getUTCMonth() - 1);
      const lastEnd = new Date(start);
      lastEnd.setUTCMonth(lastEnd.getUTCMonth() + 1);
      lastEnd.setUTCDate(0);
      lastEnd.setUTCHours(23, 59, 59, 999);
      return { from: start.toISOString(), to: lastEnd.toISOString() };
    }
    default:
      start.setUTCDate(start.getUTCDate() - 29);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

export const REPORT_PRESETS: { key: string; label: string }[] = [
  { key: "today", label: "Bugun" },
  { key: "7d", label: "7 kun" },
  { key: "30d", label: "30 kun" },
  { key: "month", label: "Bu oy" },
  { key: "last_month", label: "O‘tgan oy" },
  { key: "custom", label: "Tanlangan" },
];
