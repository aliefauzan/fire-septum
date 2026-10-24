// Write-once stores for sealed records that get one score later (forecast register, forecast
// submissions). Three modes, picked from the environment:
//
//   fs         local runs: JSON files under data/<collection>/, the score attached inside the file
//              once (the original register behaviour).
//   blob       hosted with BLOB_READ_WRITE_TOKEN: the files bundled with the deploy are read-only;
//              new records go to Vercel Blob as <prefix>/records/<name> and scores as
//              <prefix>/scores/<hash16>.json. Nothing is ever overwritten: existence is checked
//              first and every put is made with allowOverwrite: false. A list is the bundled files
//              plus the blobs (a blob score is attached to a bundled record that has none).
//   read-only  hosted without a token: reads the bundled files, refuses writes.
//
// The write-once rules are the same in every mode: a record whose hash is known is refused (409),
// and a record that already has a score keeps it (409).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The four operations the stores need from a blob store (Vercel Blob, or an in-memory fake in tests). */
export interface BlobLike {
  /** Pathnames under a prefix. */
  list(prefix: string): Promise<string[]>;
  /** Body of a blob, or null when it does not exist. */
  read(pathname: string): Promise<string | null>;
  exists(pathname: string): Promise<boolean>;
  /** Create a blob; false (and nothing written) when the pathname already exists. */
  create(pathname: string, body: string): Promise<boolean>;
}

/** In-memory BlobLike for tests. */
export function memoryBlob(): BlobLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)).sort(),
    read: async (p) => data.get(p) ?? null,
    exists: async (p) => data.has(p),
    create: async (p, body) => {
      if (data.has(p)) return false;
      data.set(p, body);
      return true;
    },
  };
}

/**
 * Vercel Blob through @vercel/blob. `access` must match the store (public by default; BLOB_ACCESS=private
 * for a private store). The package is loaded only when a token is configured, and is left out of
 * the api/index.js bundle (Vercel installs it from package.json).
 */
export function vercelBlob(token: string, access: 'public' | 'private' = 'public'): BlobLike {
  const sdk = () => import('@vercel/blob');
  const exists = async (pathname: string) => {
    const { head, BlobNotFoundError } = await sdk();
    try {
      await head(pathname, { token });
      return true;
    } catch (e) {
      if (e instanceof BlobNotFoundError) return false;
      throw e;
    }
  };
  return {
    async list(prefix) {
      const { list } = await sdk();
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const r = await list({ prefix, cursor, token, limit: 1000 });
        out.push(...r.blobs.map((b) => b.pathname));
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return out.sort();
    },
    async read(pathname) {
      const { get } = await sdk();
      const r = await get(pathname, { access, token });
      if (!r || r.statusCode !== 200) return null;
      return new Response(r.stream).text();
    },
    exists,
    async create(pathname, body) {
      if (await exists(pathname)) return false;
      const { put } = await sdk();
      try {
        await put(pathname, body, { access, token, addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
        return true;
      } catch (e) {
        // Lost a race with another writer: the blob exists now, and it is not replaced.
        if (/already exists/i.test(e instanceof Error ? e.message : String(e))) return false;
        throw e;
      }
    },
  };
}

/** Vercel Blob from BLOB_READ_WRITE_TOKEN (and BLOB_ACCESS), or null when unset. */
export function blobFromEnv(env: Record<string, string | undefined> = process.env): BlobLike | null {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return token ? vercelBlob(token, env.BLOB_ACCESS === 'private' ? 'private' : 'public') : null;
}

export interface CollectionOptions<T> {
  /** Folder of the bundled / local files. */
  dir: string;
  /** The same folder relative to the repository, for messages ('data/register'). */
  rel: string;
  /** Blob pathname prefix ('register'). */
  prefix: string;
  /** Records' files are found by this hash: their names end in _<first 16 hex digits>.json. */
  hashOf(rec: T): string;
  /** Files sit in sub-folders (data/submissions/<day>/…). */
  recursive?: boolean;
  /** The filesystem cannot be written (serverless host). */
  readOnly: boolean;
  blob?: BlobLike | null;
  /** Refusal message for writes when read-only without a blob store. */
  readOnlyError?: string;
}

export type AddResult = { status: 200; file: string } | { status: 405 | 409; error: string };
export type ScoreResult = { status: 200 } | { status: 404 | 405; error: string } | { status: 409; error: string; score: unknown };

export interface Collection<T extends { score?: unknown }> {
  mode: 'fs' | 'blob' | 'read-only';
  list(): Promise<T[]>;
  find(hash: string): Promise<T | null>;
  /** Store a new record as <name> (a file name, or <day>/<file name>). */
  add(name: string, rec: T): Promise<AddResult>;
  /** Attach the score once. */
  addScore(hash: string, score: unknown): Promise<ScoreResult>;
}

const h16 = (hash: string) => hash.slice(0, 16);

function walk(dir: string, recursive: boolean, base = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const f of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${f}` : f;
    if (f.endsWith('.json')) out.push(rel);
    else if (recursive && statSync(join(dir, f)).isDirectory()) out.push(...walk(join(dir, f), recursive, rel));
  }
  return out;
}

export function collection<T extends { score?: unknown }>(o: CollectionOptions<T>): Collection<T> {
  const mode: Collection<T>['mode'] = !o.readOnly ? 'fs' : o.blob ? 'blob' : 'read-only';
  const blob = mode === 'blob' ? o.blob! : null;
  const recPrefix = `${o.prefix}/records/`, scorePrefix = `${o.prefix}/scores/`;
  const readFile = (rel: string) => JSON.parse(readFileSync(join(o.dir, rel), 'utf8')) as T;
  const fileFor = (hash: string) => walk(o.dir, !!o.recursive).find((f) => f.endsWith(`_${h16(hash)}.json`));
  const blobFor = async (hash: string) => (blob ? (await blob.list(recPrefix)).find((p) => p.endsWith(`_${h16(hash)}.json`)) : undefined);
  const blobScore = async (hash: string) => {
    const s = blob ? await blob.read(`${scorePrefix}${h16(hash)}.json`) : null;
    return s ? JSON.parse(s) : undefined;
  };
  const withBlobScore = async (rec: T): Promise<T> => {
    if (rec.score || !blob) return rec;
    const score = await blobScore(o.hashOf(rec));
    return score ? { ...rec, score } : rec;
  };

  return {
    mode,
    async list() {
      const files = walk(o.dir, !!o.recursive).map(readFile);
      if (!blob) return files;
      const seen = new Set(files.map((r) => h16(o.hashOf(r))));
      const paths = await blob.list(recPrefix);
      const scores = new Set(await blob.list(scorePrefix));
      const out: T[] = [];
      for (const r of files) out.push(scores.has(`${scorePrefix}${h16(o.hashOf(r))}.json`) ? await withBlobScore(r) : r);
      for (const p of paths) {
        const body = await blob.read(p);
        if (!body) continue;
        const r = JSON.parse(body) as T;
        if (seen.has(h16(o.hashOf(r)))) continue;
        seen.add(h16(o.hashOf(r)));
        out.push(scores.has(`${scorePrefix}${h16(o.hashOf(r))}.json`) ? await withBlobScore(r) : r);
      }
      return out;
    },
    async find(hash) {
      const f = fileFor(hash);
      if (f) return withBlobScore(readFile(f));
      const p = await blobFor(hash);
      const body = p ? await blob!.read(p) : null;
      return body ? withBlobScore(JSON.parse(body) as T) : null;
    },
    async add(name, rec) {
      if (mode === 'read-only') return { status: 405, error: o.readOnlyError ?? 'This store is read-only here.' };
      const hash = o.hashOf(rec);
      if (!name.endsWith(`_${h16(hash)}.json`)) throw new Error(`file name ${name} does not carry the record hash`);
      if (fileFor(hash) || (await blobFor(hash))) return { status: 409, error: 'already registered' };
      if (blob) {
        if (!(await blob.create(`${recPrefix}${name}`, JSON.stringify(rec, null, 1)))) return { status: 409, error: 'already registered' };
        return { status: 200, file: `blob:${recPrefix}${name}` };
      }
      const file = join(o.dir, name);
      mkdirSync(dirname(file), { recursive: true });
      try {
        writeFileSync(file, JSON.stringify(rec, null, 1), { flag: 'wx' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { status: 409, error: 'already registered' };
        throw e;
      }
      return { status: 200, file: `${o.rel}/${name}` };
    },
    async addScore(hash, score) {
      if (mode === 'read-only') return { status: 405, error: o.readOnlyError ?? 'This store is read-only here.' };
      const rec = await this.find(hash);
      if (!rec) return { status: 404, error: 'unknown forecast' };
      // A score is written once. Anyone can recompute it from FIRMS; nobody can quietly replace it.
      if (rec.score) return { status: 409, error: 'already scored', score: rec.score };
      if (blob) {
        if (!(await blob.create(`${scorePrefix}${h16(hash)}.json`, JSON.stringify(score, null, 1)))) {
          return { status: 409, error: 'already scored', score: await blobScore(hash) };
        }
        return { status: 200 };
      }
      const f = fileFor(hash)!;
      writeFileSync(join(o.dir, f), JSON.stringify({ ...rec, score }, null, 1));
      return { status: 200 };
    },
  };
}
