import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getSettings } from "./settings";

// A tiny JSON-file database. Tables are arrays of snake_case rows, matching
// the shape the hosted app stored in Postgres, so the renderer's query
// builder (src/lib/local-db.ts) can keep the familiar from().select().eq() API.

export type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

export type Filter = {
  col: string;
  op: "eq" | "neq" | "in" | "lt" | "gt" | "lte" | "gte" | "is";
  val: any;
};

export type Query = {
  table: string;
  action: "select" | "insert" | "update" | "delete" | "upsert";
  filters?: Filter[];
  order?: { col: string; ascending: boolean }[];
  limit?: number;
  offset?: number;
  single?: "one" | "maybe";
  values?: Row | Row[];
  returning?: boolean;
  columns?: string;
};

let tables: Tables | null = null;
let saveTimer: NodeJS.Timeout | null = null;

const dbFile = () => path.join(getSettings().libraryDir, "db.json");

function load(): Tables {
  if (tables) return tables;
  try {
    tables = JSON.parse(fs.readFileSync(dbFile(), "utf8")) as Tables;
  } catch {
    tables = {};
  }
  return tables;
}

export function reloadDb() {
  flushDb();
  tables = null;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDb, 150);
}

export function flushDb() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!tables) return;
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(tables));
  fs.renameSync(tmp, file);
}

export function table(name: string): Row[] {
  const t = load();
  return (t[name] ??= []);
}

function matches(row: Row, filters: Filter[] = []) {
  return filters.every(({ col, op, val }) => {
    const v = row[col];
    switch (op) {
      case "eq":
        return v === val || (v != null && val != null && String(v) === String(val));
      case "neq":
        return v !== val;
      case "in":
        return Array.isArray(val) && val.includes(v);
      case "lt":
        return v < val;
      case "gt":
        return v > val;
      case "lte":
        return v <= val;
      case "gte":
        return v >= val;
      case "is":
        return val === null ? v == null : v === val;
    }
  });
}

function project(row: Row, columns?: string) {
  if (!columns || columns.trim() === "*" || columns.includes("*")) return { ...row };
  const out: Row = {};
  for (const c of columns
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    out[c] = row[c] ?? null;
  }
  return out;
}

function withDefaults(row: Row): Row {
  return {
    id: row.id ?? randomUUID(),
    created_at: row.created_at ?? new Date().toISOString(),
    user_id: row.user_id ?? "local",
    ...row,
  };
}

export function runQuery(q: Query): {
  data: any;
  error: { message: string } | null;
  count?: number;
} {
  try {
    const rows = table(q.table);
    let affected: Row[] = [];

    if (q.action === "insert" || q.action === "upsert") {
      const values = Array.isArray(q.values) ? q.values : [q.values ?? {}];
      for (const v of values) {
        const existing = v.id ? rows.find((r) => r.id === v.id) : undefined;
        if (existing && q.action === "upsert") {
          Object.assign(existing, v);
          affected.push(existing);
        } else if (existing) {
          throw new Error(`duplicate key value violates unique constraint "${q.table}_pkey"`);
        } else {
          const row = withDefaults(v);
          rows.push(row);
          affected.push(row);
        }
      }
      scheduleSave();
    } else if (q.action === "update") {
      affected = rows.filter((r) => matches(r, q.filters));
      const patch = Object.fromEntries(
        Object.entries((q.values as Row) ?? {}).filter(([, v]) => v !== undefined),
      );
      for (const r of affected) Object.assign(r, patch);
      scheduleSave();
    } else if (q.action === "delete") {
      affected = rows.filter((r) => matches(r, q.filters));
      const keep = rows.filter((r) => !affected.includes(r));
      load()[q.table] = keep;
      scheduleSave();
    } else {
      affected = rows.filter((r) => matches(r, q.filters));
    }

    if (q.action !== "select" && !q.returning && !q.single) {
      return { data: null, error: null };
    }

    let result = affected.slice();
    for (const o of [...(q.order ?? [])].reverse()) {
      result.sort((a, b) => {
        const av = a[o.col];
        const bv = b[o.col];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (o.ascending ? 1 : -1);
      });
    }
    const count = result.length;
    if (q.offset) result = result.slice(q.offset);
    if (q.limit != null) result = result.slice(0, q.limit);
    const projected = result.map((r) => project(r, q.columns));

    if (q.single === "one") {
      if (projected.length !== 1) {
        return { data: null, error: { message: `Expected 1 row, got ${projected.length}` } };
      }
      return { data: projected[0], error: null };
    }
    if (q.single === "maybe") return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null, count };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

// Convenience helpers for main-process code.
export const db = {
  get(tableName: string, id: string): Row | undefined {
    return table(tableName).find((r) => r.id === id);
  },
  update(tableName: string, id: string, patch: Row) {
    const row = table(tableName).find((r) => r.id === id);
    if (row) {
      Object.assign(row, patch);
      scheduleSave();
    }
    return row;
  },
  insert(tableName: string, values: Row) {
    const row = withDefaults(values);
    table(tableName).push(row);
    scheduleSave();
    return row;
  },
};
