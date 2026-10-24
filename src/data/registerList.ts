// The register as the browser reads it: the dev server's /api/register, or the files bundled with
// the code on a static deploy. Kept apart from register.ts, which also runs in Node (scripts), where
// import.meta.glob does not exist.
import type { RegisterEntry } from '../sim/register';

// The register as stored with the code, for static hosting where /api/register does not exist.
const bundled = import.meta.glob<RegisterEntry>('../../data/register/*.json', { import: 'default' });

export async function listRegister(): Promise<RegisterEntry[]> {
  try {
    const r = await fetch('/api/register');
    if (r.ok && r.headers.get('content-type')?.includes('json')) return (await r.json()).entries as RegisterEntry[];
  } catch { /* static deploy: fall through */ }
  return Promise.all(Object.values(bundled).map((load) => load()));
}
