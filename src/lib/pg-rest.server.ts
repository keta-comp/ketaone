/* eslint-disable @typescript-eslint/no-explicit-any */
// PostgREST so'rov shakliga mos qatlam: Supabase klienti o'rniga Neon + RLS.
//
// Supabase o'chirilgandan keyin ham chaqiruv joylari (`ctx.supabase.from(...)`,
// `supabaseAdmin.from(...)`) o'zgarmay ishlashi uchun shu quruvchi yozilgan.
// Har bir so'rov o'z tranzaksiyasida ishlaydi: `set local role` + `app.user_id`,
// ya'ni tenant chegarasi avvalgidek ma'lumotlar bazasi siyosatida qoladi.
import type { TransactionSql } from "postgres";

import { ownerSql, withRoleSql, type RoleName } from "./db";
import { isInternalErrorText } from "./friendly-error";

export type PgError = { message: string; details: string; hint: string; code: string };

export type PgResult<T = any> = {
  data: T;
  error: PgError | null;
  count: number | null;
  status: number;
  statusText: string;
};

type Actor = { role: RoleName; userId: string | null };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Noto'g'ri identifikator: ${name}`);
  return `"${name}"`;
}

/** Ustun ifodasi. PostgREST jsonb yo'llarini (`data->>status`, `data->items->0`)
 *  qo'llab-quvvatlaymiz: har qism alohida tekshiriladi, shuning uchun kiruvchi
 *  satr SQL'ga buzib kira olmaydi. */
function columnExpr(column: string, prefix: string): string {
  if (IDENT.test(column)) return `${prefix}${ident(column)}`;
  const segments = column.split(/(->>|->)/);
  const base = segments[0] ?? "";
  if (segments.length < 3 || !IDENT.test(base)) throw new Error(`Noto'g'ri identifikator: ${column}`);
  let expr = `${prefix}${ident(base)}`;
  for (let i = 1; i < segments.length; i += 2) {
    const operator = segments[i] ?? "";
    const key = (segments[i + 1] ?? "").replace(/^['"]|['"]$/g, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !/^\d+$/.test(key))
      throw new Error(`Noto'g'ri identifikator: ${column}`);
    // Matn kaliti kvototaladi, son indeksi shunday qoladi (jsonb array access).
    expr += `${operator}${/^\d+$/.test(key) ? key : `'${key}'`}`;
  }
  return expr;
}

class Params {
  readonly values: any[] = [];
  add(value: any): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

// ---------------------------------------------------------------- metama'lumot

type Fk = { src: string; srcCol: string; dst: string; dstCol: string };

let fkCache: Promise<Fk[]> | undefined;

function foreignKeys(): Promise<Fk[]> {
  if (!fkCache) {
    fkCache = ownerSql()`
      select src.relname::text as src, sa.attname::text as src_col,
             dst.relname::text as dst, da.attname::text as dst_col
      from pg_constraint c
      join pg_class src on src.oid = c.conrelid
      join pg_class dst on dst.oid = c.confrelid
      join pg_namespace n on n.oid = src.relnamespace
      join unnest(c.conkey) with ordinality as k(attnum, ord) on true
      join unnest(c.confkey) with ordinality as f(attnum, ord) on f.ord = k.ord
      join pg_attribute sa on sa.attrelid = src.oid and sa.attnum = k.attnum
      join pg_attribute da on da.attrelid = dst.oid and da.attnum = f.attnum
      where c.contype = 'f' and n.nspname = 'public'
    `.then((rows) =>
      rows.map((r: any) => ({ src: r.src, srcCol: r.src_col, dst: r.dst, dstCol: r.dst_col })),
    );
  }
  return fkCache;
}

type ColumnType = { udt: string; isArray: boolean; isJson: boolean };

let columnCache: Promise<Map<string, Map<string, ColumnType>>> | undefined;

function columnTypes(): Promise<Map<string, Map<string, ColumnType>>> {
  if (!columnCache) {
    columnCache = ownerSql()`
      select table_name::text as t, column_name::text as c,
             data_type::text as d, udt_name::text as u
      from information_schema.columns
      where table_schema = 'public'
    `.then((rows) => {
      const map = new Map<string, Map<string, ColumnType>>();
      for (const row of rows as any[]) {
        let table = map.get(row.t);
        if (!table) map.set(row.t, (table = new Map()));
        table.set(row.c, {
          udt: row.u,
          isArray: row.d === "ARRAY",
          isJson: row.u === "json" || row.u === "jsonb",
        });
      }
      return map;
    });
  }
  return columnCache;
}

type FnMeta = { setof: boolean };

let fnCache: Promise<Map<string, FnMeta>> | undefined;

function functionMeta(): Promise<Map<string, FnMeta>> {
  if (!fnCache) {
    fnCache = ownerSql()`
      select p.proname::text as name, p.proretset as setof
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    `.then((rows) => new Map((rows as any[]).map((r) => [r.name, { setof: r.setof }])));
  }
  return fnCache;
}

// -------------------------------------------------------------- select parsing

type SelectNode =
  | { kind: "star" }
  | { kind: "col"; name: string; alias: string | null }
  | { kind: "embed"; table: string; alias: string | null; inner: SelectNode[] };

/** Vergul bo'yicha bo'ladi, ammo qavs ichidagi vergullarni saqlaydi. */
function splitTop(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

function parseSelect(source: string): SelectNode[] {
  return splitTop(source).map((token) => {
    const open = token.indexOf("(");
    if (open !== -1 && token.endsWith(")")) {
      let head = token.slice(0, open).trim();
      const inner = token.slice(open + 1, -1);
      let alias: string | null = null;
      const colon = head.indexOf(":");
      if (colon !== -1) {
        alias = head.slice(0, colon).trim();
        head = head.slice(colon + 1).trim();
      }
      // `table!inner(...)` / `table!fk(...)` — bog'lanish nomi e'tiborga olinmaydi.
      const bang = head.indexOf("!");
      if (bang !== -1) head = head.slice(0, bang).trim();
      return { kind: "embed", table: head, alias, inner: parseSelect(inner) } as SelectNode;
    }
    if (token === "*") return { kind: "star" } as SelectNode;
    const colon = token.indexOf(":");
    if (colon !== -1) {
      return {
        kind: "col",
        alias: token.slice(0, colon).trim(),
        name: token.slice(colon + 1).trim(),
      } as SelectNode;
    }
    return { kind: "col", name: token, alias: null } as SelectNode;
  });
}

function pickFk(fks: Fk[], base: string, target: string, alias: string | null): Fk | undefined {
  const outward = fks.filter((f) => f.src === base && f.dst === target);
  if (outward.length > 1 && alias) {
    const byAlias = outward.find((f) => f.srcCol === `${alias}_id` || f.srcCol.startsWith(alias));
    if (byAlias) return byAlias;
  }
  if (outward.length) {
    const singular = target.replace(/ies$/, "y").replace(/s$/, "");
    return outward.find((f) => f.srcCol === `${singular}_id`) ?? outward[0];
  }
  return undefined;
}

function jsonObject(nodes: SelectNode[], rel: string, columns: Map<string, ColumnType> | undefined): string {
  if (nodes.some((n) => n.kind === "star")) return `to_jsonb(${rel})`;
  const pairs = nodes.map((node) => {
    if (node.kind !== "col") throw new Error("Ichma-ich joylashgan embed qo'llanmaydi.");
    const key = node.alias ?? node.name;
    void columns;
    return `'${key}', ${rel}.${ident(node.name)}`;
  });
  return `jsonb_build_object(${pairs.join(", ")})`;
}

// -------------------------------------------------------------------- filtrlar

type Filter = { sql: string };

const CMP_OPS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "like",
  ilike: "ilike",
};

function parseTuple(value: string): string[] {
  const trimmed = value.trim();
  const body = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
  return body
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""))
    .filter((part) => part.length > 0);
}

function condition(
  column: string,
  op: string,
  value: any,
  prefix: string,
  p: Params,
  types: Map<string, ColumnType> | undefined,
): string {
  const col = columnExpr(column, prefix);
  const type = types?.get(column);

  if (op === "is") {
    if (value === null || value === "null") return `${col} is null`;
    if (value === true || value === "true") return `${col} is true`;
    if (value === false || value === "false") return `${col} is false`;
    return `${col} is not distinct from ${p.add(value)}`;
  }
  if (op === "in") {
    const list = Array.isArray(value) ? value : parseTuple(String(value));
    if (!list.length) return "false";
    return `${col} in (${list.map((item) => p.add(item)).join(", ")})`;
  }
  if (op === "cs" || op === "contains") {
    if (type?.isJson) return `${col} @> ${p.add(value)}::jsonb`;
    return `${col} @> ${p.add(value)}`;
  }
  if (op === "ov" || op === "overlaps") return `${col} && ${p.add(value)}`;

  const cmp = CMP_OPS[op];
  if (!cmp) throw new Error(`Qo'llanmaydigan filtr amali: ${op}`);
  if (value === null) return cmp === "=" ? `${col} is null` : `${col} is not null`;
  return `${col} ${cmp} ${p.add(value)}`;
}

/** PostgREST `or(...)` satrini tahlil qiladi: `a.ilike.%x%,b.is.null`. */
function parseOrExpression(
  expression: string,
  prefix: string,
  p: Params,
  types: Map<string, ColumnType> | undefined,
): string {
  const parts = splitTop(expression).map((term) => {
    const first = term.indexOf(".");
    const second = term.indexOf(".", first + 1);
    if (first === -1 || second === -1) throw new Error(`or() shakli tushunarsiz: ${term}`);
    const column = term.slice(0, first);
    let op = term.slice(first + 1, second);
    let raw = term.slice(second + 1);
    let negate = false;
    if (op === "not") {
      negate = true;
      const third = raw.indexOf(".");
      op = raw.slice(0, third);
      raw = raw.slice(third + 1);
    }
    const value = raw === "null" ? null : raw;
    const built = condition(column, op, value, prefix, p, types);
    return negate ? `not (${built})` : built;
  });
  return `(${parts.join(" or ")})`;
}

// ---------------------------------------------------------------------- builder

type Mode = "select" | "insert" | "update" | "delete" | "upsert" | "rpc";

// Postgres tizim xatolarining xabari jadval/ustun/kiymat nomini ochib beradi,
// shuning uchun ular foydalanuvchiga umumlik ko'rinishda chiqadi; app o'zi
// ko'targan xatolar (masalan 42501/55000 privacy trigger) o'z holicha qoladi.
const SYSTEM_ERROR_MESSAGES: Record<string, string> = {
  "23502": "Majburiy maydon to'ldirilmagan.",
  "23503": "Bog'langan yozuv topilmadi yoki uni o'chirib bo'lmaydi.",
  "23505": "Bunday yozuv allaqachon mavjud.",
  "23514": "Kiritilgan qiymat ruxsat etilgan chegaradan chiqadi.",
  "23501": "Yangilanadigan yozuv topilmadi.",
  "22P02": "Kiritilgan qiymat formati noto'g'ri.",
  "22007": "Sana yoki vaqt formati noto'g'ri.",
  "22001": "Kiritilgan qiymat juda uzun.",
  "42703": "So'rovda noma'lum ustun bor.",
  "42P01": "So'rov jadvali mavjud emas.",
  "42883": "Bu amallar uchun qo'llab-quvvatlanmaydi.",
  "42601": "So'rov sozlanmagan.",
  "40001": "Ma'lumotlar ayni paytda boshqalar tomonidan tahrirlanyapti — qaytadan urinib ko'ring.",
  "40P01": "Ma'lumotlar band — qaytadan urinib ko'ring.",
  "53200": "Ma'lumotlar bazasi resurslari tugadi.",
  "57014": "So'rov juda uzoq davom etdi — qisqartirib qaytadan urinib ko'ring.",
  "58000": "Ma'lumotlar bazasi vaqtinchalik mavjud emas.",
  "08006": "Ma'lumotlar bazasi bilan aloqa uzildi.",
  "08001": "Ma'lumotlar bazasiga ulanib bo'lmadi.",
};

function toError(
  error: unknown,
  context?: { actor: Actor; table: string; mode: Mode },
): PgError {
  const anyError = error as any;
  const code = anyError?.code ? String(anyError.code) : "UNKNOWN";
  const raw = anyError?.message ? String(anyError.message) : "";
  const generic = SYSTEM_ERROR_MESSAGES[code];
  if (generic) {
    console.error(`[pg] ${code}: ${raw}`, anyError?.detail ? `detail: ${anyError.detail}` : "");
    return { message: generic, details: "", hint: "", code };
  }
  if (isInternalErrorText(raw)) {
    console.error(`[pg] ${code}: ${raw}`, anyError?.stack ?? "");
    // Matn foydalanuvchiga ko'rsatilmaydi va Vercel logi ham to'liq o'qilmaydi — sababni
    // keyinchalik topish uchun xatoni error_events jadvaliga tushiramiz.
    if (context) {
      void import("./error-events.server")
        .then(({ captureError }) =>
          captureError({
            error,
            route: `pg:${context.mode}/${context.table}`,
            userId: context.actor.userId,
          }),
        )
        .catch(() => {});
    }
    return {
      message: "Nimadir xato ketdi. Qayta urinib ko'ring.",
      details: "",
      hint: "",
      code,
    };
  }
  return {
    message: raw || "Ma'lumotlar bazasi xatosi",
    details: "",
    hint: "",
    code,
  };
}

class Builder<T = any[]> implements PromiseLike<PgResult<T>> {
  private mode: Mode = "select";
  private selectSource: string | null = null;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private rowMode: "many" | "single" | "maybe" = "many";
  private countMode: "exact" | "planned" | "estimated" | null = null;
  private headOnly = false;
  private payload: Record<string, any>[] = [];
  private conflictTarget: string | null = null;
  private ignoreDuplicates = false;
  private rpcArgs: Record<string, any> = {};

  constructor(
    private readonly actor: Actor,
    private readonly table: string,
  ) {}

  // ---- rejim

  select(columns = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.mode === "select") this.mode = "select";
    this.selectSource = columns || "*";
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(values: Record<string, any> | Record<string, any>[]) {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    this.selectSource = null;
    return this;
  }

  upsert(
    values: Record<string, any> | Record<string, any>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.conflictTarget = options?.onConflict ?? null;
    this.ignoreDuplicates = options?.ignoreDuplicates ?? false;
    this.selectSource = null;
    return this;
  }

  update(values: Record<string, any>) {
    this.mode = "update";
    this.payload = [values];
    this.selectSource = null;
    return this;
  }

  delete() {
    this.mode = "delete";
    this.selectSource = null;
    return this;
  }

  rpcCall(args: Record<string, any>) {
    this.mode = "rpc";
    this.rpcArgs = args ?? {};
    return this;
  }

  // ---- filtrlar (SQL qurilishi kechiktiriladi: ustun turlari kerak)

  private pending: { column: string; op: string; value: any; negate: boolean }[] = [];
  private pendingOr: string[] = [];

  eq(column: string, value: any) {
    this.pending.push({ column, op: "eq", value, negate: false });
    return this;
  }
  neq(column: string, value: any) {
    this.pending.push({ column, op: "neq", value, negate: false });
    return this;
  }
  gt(column: string, value: any) {
    this.pending.push({ column, op: "gt", value, negate: false });
    return this;
  }
  gte(column: string, value: any) {
    this.pending.push({ column, op: "gte", value, negate: false });
    return this;
  }
  lt(column: string, value: any) {
    this.pending.push({ column, op: "lt", value, negate: false });
    return this;
  }
  lte(column: string, value: any) {
    this.pending.push({ column, op: "lte", value, negate: false });
    return this;
  }
  like(column: string, pattern: string) {
    this.pending.push({ column, op: "like", value: pattern, negate: false });
    return this;
  }
  ilike(column: string, pattern: string) {
    this.pending.push({ column, op: "ilike", value: pattern, negate: false });
    return this;
  }
  is(column: string, value: any) {
    this.pending.push({ column, op: "is", value, negate: false });
    return this;
  }
  in(column: string, values: any[]) {
    this.pending.push({ column, op: "in", value: values, negate: false });
    return this;
  }
  contains(column: string, value: any) {
    this.pending.push({ column, op: "contains", value, negate: false });
    return this;
  }
  overlaps(column: string, value: any) {
    this.pending.push({ column, op: "overlaps", value, negate: false });
    return this;
  }
  filter(column: string, op: string, value: any) {
    this.pending.push({ column, op, value, negate: false });
    return this;
  }
  not(column: string, op: string, value: any) {
    this.pending.push({ column, op, value, negate: true });
    return this;
  }
  match(query: Record<string, any>) {
    for (const [column, value] of Object.entries(query)) this.eq(column, value);
    return this;
  }
  or(expression: string) {
    this.pendingOr.push(expression);
    return this;
  }

  // ---- shakl

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    const direction = options?.ascending === false ? "desc" : "asc";
    const nulls =
      options?.nullsFirst === undefined ? "" : options.nullsFirst ? " nulls first" : " nulls last";
    this.orders.push(`${ident(column)} ${direction}${nulls}`);
    return this;
  }
  limit(count: number) {
    this.limitValue = count;
    return this;
  }
  range(from: number, to: number) {
    this.offsetValue = from;
    this.limitValue = to - from + 1;
    return this;
  }
  // Bitta qator so'ralganda `data` massiv emas — chaqiruv joylari `row?.field` ko'rinishida ishlaydi.
  single(): Builder<any> {
    this.rowMode = "single";
    return this as unknown as Builder<any>;
  }
  maybeSingle(): Builder<any> {
    this.rowMode = "maybe";
    return this as unknown as Builder<any>;
  }

  then<R1 = PgResult<T>, R2 = never>(
    onfulfilled?: ((value: PgResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  // ---- bajarish

  private async run(): Promise<PgResult<T>> {
    try {
      return await withRoleSql(this.actor, (tx) => this.execute(tx));
    } catch (error) {
      return {
        data: (this.rowMode === "many" ? null : null) as T,
        error: toError(error, { actor: this.actor, table: this.table, mode: this.mode }),
        count: null,
        status: 400,
        statusText: "Bad Request",
      };
    }
  }

  private async whereClause(p: Params, prefix: string): Promise<string> {
    const types = (await columnTypes()).get(this.table);
    const parts = [
      ...this.pending.map((f) => {
        const built = condition(f.column, f.op, f.value, prefix, p, types);
        return f.negate ? `not (${built})` : built;
      }),
      ...this.pendingOr.map((expression) => parseOrExpression(expression, prefix, p, types)),
      ...this.filters.map((f) => f.sql),
    ];
    return parts.length ? ` where ${parts.join(" and ")}` : "";
  }

  private async selectList(prefix: string): Promise<string> {
    const source = this.selectSource ?? "*";
    const nodes = parseSelect(source);
    if (!nodes.some((n) => n.kind === "embed")) {
      if (nodes.some((n) => n.kind === "star")) return `${prefix}*`;
      return nodes
        .map((n) =>
          n.kind === "col"
            ? n.alias
              ? `${prefix}${ident(n.name)} as ${ident(n.alias)}`
              : `${prefix}${ident(n.name)}`
            : "",
        )
        .filter(Boolean)
        .join(", ");
    }

    const fks = await foreignKeys();
    const columns = await columnTypes();
    const pieces: string[] = [];
    let embedIndex = 0;
    for (const node of nodes) {
      if (node.kind === "star") {
        pieces.push(`${prefix}*`);
        continue;
      }
      if (node.kind === "col") {
        pieces.push(
          node.alias
            ? `${prefix}${ident(node.name)} as ${ident(node.alias)}`
            : `${prefix}${ident(node.name)}`,
        );
        continue;
      }
      const rel = `e${embedIndex}`;
      embedIndex += 1;
      const label = node.alias ?? node.table;
      // PostgREST `xodimlar:employee_id(...)` ko'rinishida FK ustunini beradi — bunda
      // `node.table` aslida ustun nomi, shuning uchun jadvalni shu ustundan topamiz.
      const viaColumn = node.alias
        ? fks.find((f) => f.src === this.table && f.srcCol === node.table)
        : undefined;
      const target = viaColumn?.dst ?? node.table;
      const outward = viaColumn ?? pickFk(fks, this.table, target, node.alias);
      if (outward) {
        const object = jsonObject(node.inner, rel, columns.get(target));
        pieces.push(
          `(select ${object} from public.${ident(target)} ${rel}` +
            ` where ${rel}.${ident(outward.dstCol)} = ${prefix}${ident(outward.srcCol)}) as ${ident(label)}`,
        );
        continue;
      }
      const inward = pickFk(fks, target, this.table, null);
      if (!inward) throw new Error(`${this.table} va ${target} orasida bog'lanish topilmadi.`);
      const object = jsonObject(node.inner, rel, columns.get(target));
      pieces.push(
        `(select coalesce(jsonb_agg(${object}), '[]'::jsonb) from public.${ident(target)} ${rel}` +
          ` where ${rel}.${ident(inward.srcCol)} = ${prefix}${ident(inward.dstCol)}) as ${ident(label)}`,
      );
    }
    return pieces.join(", ");
  }

  private async writeValue(column: string, value: any, p: Params): Promise<string> {
    const type = (await columnTypes()).get(this.table)?.get(column);
    if (type?.isJson && value !== null && typeof value === "object") {
      // postgres.js `::jsonb` cast ostidagi parametrni o'zi kodlaydi — oldindan
      // JSON.stringify qilsak qiymat ikki marta kodlanib jsonb ichida satr bo'lib qoladi.
      return `${p.add(value)}::jsonb`;
    }
    return p.add(value ?? null);
  }

  /**
   * PostgREST vaqtni ISO satr ko'rinishida qaytaradi, postgres.js esa uni Date
   * obyektiga aylantiradi. Chaqiruvchilar `a.created_at.localeCompare(b)` kabi
   * satr amallariga tayanadi, shuning uchun moslik qatlami chiqishda orqaga
   * qaytaradi. `date` ustunlarini lokal kun sifatida beramiz — toISOString
   * ularni bir kun oldinga orqaga siljitadi.
   */
  private async serializeDates(rows: any[]): Promise<any[]> {
    if (!rows.some((r) => r && Object.values(r).some((v) => v instanceof Date))) return rows;
    const types = (await columnTypes()).get(this.table);
    return rows.map((row) => {
      if (!row || !Object.values(row).some((v) => v instanceof Date)) return row;
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
          if (!(value instanceof Date)) return [key, value];
          if (types?.get(key)?.udt === "date") {
            const pad = (n: number) => String(n).padStart(2, "0");
            return [
              key,
              `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
            ];
          }
          return [key, value.toISOString()];
        }),
      );
    });
  }

  private async shape(rows: any[], count: number | null): Promise<PgResult<T>> {
    const out = await this.serializeDates(rows);
    if (this.rowMode === "single" || this.rowMode === "maybe") {
      if (out.length === 1) {
        return { data: out[0] as T, error: null, count, status: 200, statusText: "OK" };
      }
      if (out.length === 0 && this.rowMode === "maybe") {
        return { data: null as T, error: null, count, status: 200, statusText: "OK" };
      }
      return {
        data: null as T,
        error: {
          message: "Yozuv topilmadi yoki bir nechta yozuv qaytdi.",
          details: `Natijada ${out.length} qator`,
          hint: "",
          code: "PGRST116",
        },
        count,
        status: 406,
        statusText: "Not Acceptable",
      };
    }
    return { data: out as T, error: null, count, status: 200, statusText: "OK" };
  }

  private async execute(tx: TransactionSql): Promise<PgResult<T>> {
    if (this.mode === "rpc") return this.executeRpc(tx);

    const relation = `public.${ident(this.table)}`;

    if (this.mode === "select") {
      const alias = "t";
      const p = new Params();
      const where = await this.whereClause(p, `${alias}.`);

      let count: number | null = null;
      if (this.countMode) {
        const rows = await tx.unsafe(
          `select count(*)::int as c from ${relation} ${alias}${where}`,
          p.values,
        );
        count = (rows as any[])[0]?.c ?? 0;
        if (this.headOnly) {
          return { data: null as T, error: null, count, status: 200, statusText: "OK" };
        }
      }

      const dataParams = new Params();
      const dataWhere = await this.whereClause(dataParams, `${alias}.`);
      const columns = await this.selectList(`${alias}.`);
      const order = this.orders.length ? ` order by ${this.orders.map((o) => `${alias}.${o}`).join(", ")}` : "";
      const limit = this.limitValue === null ? "" : ` limit ${Number(this.limitValue)}`;
      const offset = this.offsetValue === null ? "" : ` offset ${Number(this.offsetValue)}`;
      const rows = await tx.unsafe(
        `select ${columns} from ${relation} ${alias}${dataWhere}${order}${limit}${offset}`,
        dataParams.values,
      );
      return this.shape(rows as any[], count);
    }

    const returning = this.selectSource ? ` returning ${await this.selectList("")}` : "";

    if (this.mode === "insert" || this.mode === "upsert") {
      const p = new Params();
      const keys = [...new Set(this.payload.flatMap((row) => Object.keys(row)))].filter(
        (key) => this.payload.some((row) => row[key] !== undefined),
      );
      if (!keys.length) throw new Error("Insert uchun ustunlar berilmagan.");
      const tuples: string[] = [];
      for (const row of this.payload) {
        const cells: string[] = [];
        for (const key of keys) {
          cells.push(row[key] === undefined ? "default" : await this.writeValue(key, row[key], p));
        }
        tuples.push(`(${cells.join(", ")})`);
      }
      let conflict = "";
      if (this.mode === "upsert") {
        const target = this.conflictTarget
          ? `(${this.conflictTarget
              .split(",")
              .map((column) => ident(column.trim()))
              .join(", ")})`
          : "";
        if (this.ignoreDuplicates || !target) {
          conflict = ` on conflict ${target} do nothing`;
        } else {
          const assignments = keys
            .filter((key) => !this.conflictTarget?.split(",").map((c) => c.trim()).includes(key))
            .map((key) => `${ident(key)} = excluded.${ident(key)}`);
          conflict = assignments.length
            ? ` on conflict ${target} do update set ${assignments.join(", ")}`
            : ` on conflict ${target} do nothing`;
        }
      }
      const rows = await tx.unsafe(
        `insert into ${relation} (${keys.map(ident).join(", ")}) values ${tuples.join(", ")}${conflict}${returning}`,
        p.values,
      );
      return this.selectSource
        ? this.shape(rows as any[], null)
        : { data: null as T, error: null, count: null, status: 201, statusText: "Created" };
    }

    if (this.mode === "update") {
      const p = new Params();
      const patch = this.payload[0] ?? {};
      const assignments: string[] = [];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        assignments.push(`${ident(key)} = ${await this.writeValue(key, value, p)}`);
      }
      if (!assignments.length) throw new Error("Update uchun maydonlar berilmagan.");
      const where = await this.whereClause(p, "");
      if (!where) throw new Error("Update filtrsiz bajarilmaydi.");
      const rows = await tx.unsafe(
        `update ${relation} set ${assignments.join(", ")}${where}${returning}`,
        p.values,
      );
      return this.selectSource
        ? this.shape(rows as any[], null)
        : { data: null as T, error: null, count: null, status: 204, statusText: "No Content" };
    }

    // delete
    const p = new Params();
    const where = await this.whereClause(p, "");
    if (!where) throw new Error("Delete filtrsiz bajarilmaydi.");
    const rows = await tx.unsafe(`delete from ${relation}${where}${returning}`, p.values);
    return this.selectSource
      ? this.shape(rows as any[], null)
      : { data: null as T, error: null, count: null, status: 204, statusText: "No Content" };
  }

  private async executeRpc(tx: TransactionSql): Promise<PgResult<T>> {
    const meta = (await functionMeta()).get(this.table);
    if (!meta) throw new Error(`Funksiya topilmadi: ${this.table}`);
    const p = new Params();
    const args = Object.entries(this.rpcArgs)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${ident(name)} => ${p.add(value)}`)
      .join(", ");
    const call = `public.${ident(this.table)}(${args})`;

    if (meta.setof) {
      const rows = await tx.unsafe(`select * from ${call}`, p.values);
      return this.shape(rows as any[], null);
    }
    const rows = await tx.unsafe(`select ${call} as value`, p.values);
    const value = (rows as any[])[0]?.value ?? null;
    return { data: value as T, error: null, count: null, status: 200, statusText: "OK" };
  }
}

// ----------------------------------------------------------------------- klient

export type DbClient = {
  from: (table: string) => Builder;
  rpc: (fn: string, args?: Record<string, any>) => Builder<any>;
};

function client(actor: Actor): DbClient {
  return {
    from: (table: string) => new Builder(actor, table),
    rpc: (fn: string, args?: Record<string, any>) =>
      new Builder<any>(actor, fn).rpcCall(args ?? {}),
  };
}

/** Foydalanuvchi nomidan: RLS faol, tenant chegarasi siyosatlarda. */
export const userClient = (userId: string): DbClient => client({ role: "app_user", userId });

/** Avtorizatsiyasiz ommaviy so'rovlar (bron sahifasi kabi). */
export const anonClient = (): DbClient => client({ role: "app_anon", userId: null });

/** Platforma xizmati: BYPASSRLS. Faqat webhook/admin oqimlarida. */
export const serviceClient = (userId: string | null = null): DbClient =>
  client({ role: "app_service", userId });
