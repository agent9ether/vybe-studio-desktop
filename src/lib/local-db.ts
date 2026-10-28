import { invoke } from "./bridge";

// A small query builder with the same surface the hosted app used from
// supabase-js (from().select().eq().order()…), executed against the local
// JSON database in the main process. Storage buckets map to folders inside
// the library's media directory.

type Result<T = any> = { data: T; error: { message: string } | null; count?: number };

type Filter = { col: string; op: string; val: unknown };

class QueryBuilder<T = any> implements PromiseLike<Result<T>> {
  private q: {
    table: string;
    action: "select" | "insert" | "update" | "delete" | "upsert";
    filters: Filter[];
    order: { col: string; ascending: boolean }[];
    limit?: number;
    offset?: number;
    single?: "one" | "maybe";
    values?: unknown;
    returning?: boolean;
    columns?: string;
  };

  constructor(table: string) {
    this.q = { table, action: "select", filters: [], order: [] };
  }

  select(columns = "*") {
    if (this.q.action === "select") this.q.columns = columns;
    else this.q.returning = true;
    return this;
  }
  insert(values: unknown) {
    this.q.action = "insert";
    this.q.values = values;
    return this;
  }
  upsert(values: unknown) {
    this.q.action = "upsert";
    this.q.values = values;
    return this;
  }
  update(values: unknown) {
    this.q.action = "update";
    this.q.values = values;
    return this;
  }
  delete() {
    this.q.action = "delete";
    return this;
  }
  private filter(col: string, op: string, val: unknown) {
    this.q.filters.push({ col, op, val });
    return this;
  }
  eq(col: string, val: unknown) {
    return this.filter(col, "eq", val);
  }
  neq(col: string, val: unknown) {
    return this.filter(col, "neq", val);
  }
  in(col: string, val: unknown[]) {
    return this.filter(col, "in", val);
  }
  lt(col: string, val: unknown) {
    return this.filter(col, "lt", val);
  }
  gt(col: string, val: unknown) {
    return this.filter(col, "gt", val);
  }
  lte(col: string, val: unknown) {
    return this.filter(col, "lte", val);
  }
  gte(col: string, val: unknown) {
    return this.filter(col, "gte", val);
  }
  is(col: string, val: unknown) {
    return this.filter(col, "is", val);
  }
  match(obj: Record<string, unknown>) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v);
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.q.order.push({ col, ascending: opts.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.q.limit = n;
    return this;
  }
  range(from: number, to: number) {
    this.q.offset = from;
    this.q.limit = to - from + 1;
    return this;
  }
  single() {
    this.q.single = "one";
    return this as unknown as QueryBuilder<any>;
  }
  maybeSingle() {
    this.q.single = "maybe";
    return this as unknown as QueryBuilder<any>;
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return invoke<Result<T>>("db:query", this.q)
      .catch((e: Error) => ({ data: null as T, error: { message: e.message } }))
      .then(onfulfilled, onrejected);
  }
}

function bucket(name: string) {
  const rel = (p: string) => `${name}/${p.replace(/^\/+/, "")}`;
  const urlFor = (p: string) =>
    `vybe-media://local/${rel(p).split("/").map(encodeURIComponent).join("/")}`;
  return {
    async upload(path: string, file: Blob | ArrayBuffer, _opts?: unknown) {
      try {
        const bytes = file instanceof Blob ? await file.arrayBuffer() : file;
        await invoke("storage:upload", { path: rel(path), bytes });
        return { data: { path }, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    getPublicUrl(path: string) {
      return { data: { publicUrl: urlFor(path) } };
    },
    async remove(paths: string[]) {
      await invoke("storage:remove", { urls: paths.map(urlFor) });
      return { data: null, error: null };
    },
  };
}

export const db = {
  from: <T = any>(table: string) => new QueryBuilder<T>(table),
  storage: { from: bucket },
};

/** Save a user-picked file into the library and return its media URL. */
export async function importFile(file: File | Blob, name?: string, subdir = "imports") {
  const bytes = await file.arrayBuffer();
  return invoke<string>("media:import", {
    name: name ?? (file as File).name ?? "upload.bin",
    bytes,
    subdir,
  });
}
