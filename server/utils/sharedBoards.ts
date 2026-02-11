import type { PersistedBoard } from "~/types/caseboard";

export type ShareRole = "view" | "edit";

interface SharedBoardRecord {
  id: string;
  board: PersistedBoard;
  viewToken: string;
  editToken: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

const STORAGE_PREFIX = "shared-board:";
const shareWaiters = new Map<string, Set<(revision: number) => void>>();

function storageKey(id: string) {
  return `${STORAGE_PREFIX}${id}`;
}

export function createShareRecord(board: PersistedBoard) {
  const id = crypto.randomUUID();
  const viewToken = `${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
  const editToken = `${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const record: SharedBoardRecord = {
    id,
    board,
    viewToken,
    editToken,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };

  return {
    record,
    id,
    viewToken,
    editToken,
  };
}

function getDataStorageCandidates() {
  return [
    { storage: useStorage("data"), name: "data" },
    { storage: useStorage("kv"), name: "kv" },
    { storage: useStorage(), name: "default" },
  ];
}

function recordTimestamp(value: string | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecordNewer(next: SharedBoardRecord, current: SharedBoardRecord | null) {
  if (!current) return true;
  const nextRevision = Number(next.revision ?? 0);
  const currentRevision = Number(current.revision ?? 0);
  if (nextRevision !== currentRevision) return nextRevision > currentRevision;
  const nextUpdatedAt = recordTimestamp(next.updatedAt);
  const currentUpdatedAt = recordTimestamp(current.updatedAt);
  return nextUpdatedAt > currentUpdatedAt;
}

export async function saveShareRecord(record: SharedBoardRecord) {
  const key = storageKey(record.id);
  const storages = getDataStorageCandidates();
  await Promise.all(
    storages.map(async ({ storage }) => {
      try {
        await storage.setItem(key, record);
      } catch {
        // Best effort to keep storage backends aligned.
      }
    }),
  );
}

export async function getShareRecord(id: string) {
  const key = storageKey(id);
  const storages = getDataStorageCandidates();
  let newest: SharedBoardRecord | null = null;

  for (const { storage } of storages) {
    try {
      const record = (await storage.getItem(key)) as SharedBoardRecord | null;
      if (record && isRecordNewer(record, newest)) {
        newest = record;
      }
    } catch {
      // Try the next storage candidate.
    }
  }

  return newest;
}

export function resolveRole(record: SharedBoardRecord, token: string): ShareRole | null {
  if (token === record.editToken) return "edit";
  if (token === record.viewToken) return "view";
  return null;
}

export async function updateSharedBoard(record: SharedBoardRecord, board: PersistedBoard) {
  const newest = await getShareRecord(record.id);
  const base = newest ?? record;
  const next: SharedBoardRecord = {
    ...base,
    board,
    updatedAt: new Date().toISOString(),
    revision: Math.max(1, Number(base.revision ?? 0)) + 1,
  };
  await saveShareRecord(next);
  notifyShareRevision(next.id, next.revision);
  return next;
}

function notifyShareRevision(id: string, revision: number) {
  const waiters = shareWaiters.get(id);
  if (!waiters || !waiters.size) return;
  waiters.forEach((resolve) => resolve(revision));
  shareWaiters.delete(id);
}

export async function waitForShareRevision(id: string, sinceRevision: number, timeoutMs: number) {
  if (!Number.isFinite(sinceRevision) || timeoutMs <= 0) return null;

  return await new Promise<number | null>((resolve) => {
    const timeout = setTimeout(() => {
      const set = shareWaiters.get(id);
      if (set) {
        set.delete(onRevision);
        if (!set.size) shareWaiters.delete(id);
      }
      resolve(null);
    }, timeoutMs);

    const onRevision = (revision: number) => {
      clearTimeout(timeout);
      const set = shareWaiters.get(id);
      if (set) {
        set.delete(onRevision);
        if (!set.size) shareWaiters.delete(id);
      }
      resolve(revision);
    };

    const waiters = shareWaiters.get(id) ?? new Set<(revision: number) => void>();
    waiters.add(onRevision);
    shareWaiters.set(id, waiters);
  });
}
