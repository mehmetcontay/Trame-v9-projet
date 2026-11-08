// Stockage local des projets (IndexedDB dans le navigateur, mémoire pour les tests).
import type { Project } from '../model/types';
import { parseProject, serializeProject } from './serialize';

export interface StoredProject { id: string; name: string; updatedAt: number; data: string }
export interface KV {
  get(id: string): Promise<StoredProject | undefined>;
  put(rec: StoredProject): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<StoredProject[]>;
}

export class MemoryKV implements KV {
  private m = new Map<string, StoredProject>();
  async get(id: string) { const r = this.m.get(id); return r ? { ...r } : undefined; }
  async put(r: StoredProject) { this.m.set(r.id, { ...r }); }
  async delete(id: string) { this.m.delete(id); }
  async list() { return [...this.m.values()]; }
}

export class IdbKV implements KV {
  private dbp: Promise<IDBDatabase>;
  constructor(name = 'trame', private store = 'projects') {
    this.dbp = new Promise((res, rej) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(store, { keyPath: 'id' });
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.dbp;
    return new Promise((res, rej) => {
      const tx = db.transaction(this.store, mode);
      const r = f(tx.objectStore(this.store));
      let result: T;
      r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => res(result);
      tx.onabort = () => rej(tx.error ?? r.error ?? new Error('Transaction annulée.'));
      tx.onerror = () => rej(tx.error ?? r.error ?? new Error('Erreur de stockage.'));
    });
  }
  get(id: string) { return this.tx<StoredProject | undefined>('readonly', (s) => s.get(id)); }
  async put(r: StoredProject) { await this.tx('readwrite', (s) => s.put(r)); }
  async delete(id: string) { await this.tx('readwrite', (s) => s.delete(id)); }
  list() { return this.tx<StoredProject[]>('readonly', (s) => s.getAll()); }
}

export class ProjectStore {
  constructor(private kv: KV) {}
  async save(p: Project): Promise<void> {
    await this.kv.put({ id: p.id, name: p.name, updatedAt: Date.now(), data: serializeProject(p) });
  }
  async load(id: string): Promise<Project> {
    const r = await this.kv.get(id);
    if (!r) throw new Error('Projet introuvable sur cet appareil.');
    return parseProject(r.data);
  }
  async list(): Promise<{ id: string; name: string; updatedAt: number }[]> {
    return (await this.kv.list()).map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  remove(id: string) { return this.kv.delete(id); }
}
