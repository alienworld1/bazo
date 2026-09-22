import { link, lstat, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PrivatePlanBlobRecordV1 } from '@bazo/plan-crypto';
import { parsePrivatePlanBlobRecord, serializePrivatePlanBlobRecord } from '@bazo/plan-crypto';

export class LocalPrivatePlanBlobAdapter {
  constructor(private readonly directory: string) {}

  async get(owner: string, plan: string) {
    const file = this.file(owner, plan);
    try { if ((await lstat(file)).isSymbolicLink()) return undefined; return parsePrivatePlanBlobRecord(await readFile(file, 'utf8')); } catch { return undefined; }
  }

  async put(record: PrivatePlanBlobRecordV1, expectedHash?: string) {
    const file = this.file(record.owner, record.plan);
    return withLock(file, async () => {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const existing = await this.get(record.owner, record.plan);
      if (existing && existing.ciphertextHash === record.ciphertextHash) return { kind: 'idempotent' as const, record: existing };
      if (existing && expectedHash !== existing.ciphertextHash) return { kind: 'conflict' as const, record: existing };
      if (!existing && expectedHash) return { kind: 'conflict' as const };
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(serializePrivatePlanBlobRecord(record), 'utf8'); await handle.sync(); } finally { await handle.close(); }
      if (!existing) {
        try { await link(temporary, file); } catch {
          await unlink(temporary).catch(() => undefined);
          const raced = await this.get(record.owner, record.plan);
          return raced?.ciphertextHash === record.ciphertextHash
            ? { kind: 'idempotent' as const, record: raced }
            : { kind: 'conflict' as const, record: raced };
        }
        await unlink(temporary);
      } else {
        try { await stat(file); } catch { return { kind: 'conflict' as const }; }
        await rename(temporary, file);
      }
      return { kind: 'saved' as const, record };
    });
  }

  private file(owner: string, plan: string) {
    const root = resolve(this.directory);
    const file = resolve(root, `${owner}-${plan}.json`);
    if (!file.startsWith(`${root}/`)) throw new Error('invalid storage path');
    return file;
  }
}

const pendingWrites = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => current);
  pendingWrites.set(key, queued);
  await previous;
  try { return await action(); } finally { release(); if (pendingWrites.get(key) === queued) pendingWrites.delete(key); }
}
