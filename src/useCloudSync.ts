import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppRecord } from "./types";
import { dropLocalOnlySamples, mergeRecords } from "./data";
import { cloudConfigured, pullCloudRecords, pushCloudRecords } from "./sync";

export type SyncState = "local" | "connecting" | "synced" | "syncing" | "offline";

const SYNC_STATE_KEY = "daybook.sync.v2";
const POLL_MS = 10_000;
const PUSH_DEBOUNCE_MS = 400;

/** What this device knows about the cloud: the pull cursor and the newest version of each record the cloud has confirmed. */
type PersistedSync = { cursor?: string; known: Record<string, number>; joined?: boolean };

function loadSyncState(): PersistedSync {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) ?? "null") as PersistedSync | null;
    if (parsed && typeof parsed === "object" && parsed.known && typeof parsed.known === "object") return parsed;
  } catch { /* start fresh */ }
  return { known: {} };
}

function saveSyncState(state: PersistedSync) {
  try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state)); } catch { /* the next successful sync rewrites it */ }
}

/** Records edited on this device that the cloud has not confirmed yet. */
export function pendingRecords(records: AppRecord[], known: Record<string, number>) {
  return records.filter((record) => record.type !== "journal" && record.updatedAt > (known[record.id] ?? Number.NEGATIVE_INFINITY));
}

/** True when both lists hold exactly the same record objects (order does not matter). */
export function sameRecords(a: AppRecord[], b: AppRecord[]) {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((record) => [record.id, record]));
  return b.every((record) => byId.get(record.id) === record);
}

/**
 * Applies what was just pulled from the cloud to a list of local records: drops this device's
 * untouched starter samples when joining a family store that already has records, then keeps the
 * newest copy of every record. Returns the same array when nothing changed.
 */
export function applyRemote(current: AppRecord[], remote: AppRecord[], joining: boolean) {
  let next = current;
  if (joining && remote.length) next = dropLocalOnlySamples(next, new Set(remote.map((record) => record.id)));
  if (remote.length) next = mergeRecords(next, remote);
  return sameRecords(current, next) ? current : next;
}

/**
 * Keeps this device's records in step with the shared family store: pulls changes from other devices
 * (every few seconds, and immediately when the app comes back to the foreground or online) and pushes
 * local edits until the cloud has confirmed them. Unsent edits survive reloads and are retried.
 */
export function useCloudSync(records: AppRecord[], setRecords: Dispatch<SetStateAction<AppRecord[]>>) {
  const [status, setStatus] = useState<SyncState>(cloudConfigured ? "connecting" : "local");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const recordsRef = useRef(records);
  const stateRef = useRef<PersistedSync>(loadSyncState());
  const running = useRef(false);
  const runAgain = useRef(false);
  const hasSynced = useRef(false);

  const cycle = useCallback(async () => {
    const state = stateRef.current;
    const joining = !state.joined;
    const { records: remote, cursor } = await pullCloudRecords(joining ? undefined : state.cursor);
    for (const record of remote) state.known[record.id] = Math.max(state.known[record.id] ?? Number.NEGATIVE_INFINITY, record.updatedAt);
    const working = applyRemote(recordsRef.current, remote, joining);
    if (working !== recordsRef.current) {
      recordsRef.current = working;
      setRecords((current) => applyRemote(current, remote, joining));
    }
    state.cursor = cursor ?? state.cursor;
    state.joined = true;
    saveSyncState(state);

    const pending = pendingRecords(working, state.known);
    if (pending.length) {
      await pushCloudRecords(pending);
      for (const record of pending) state.known[record.id] = Math.max(state.known[record.id] ?? Number.NEGATIVE_INFINITY, record.updatedAt);
      saveSyncState(state);
    }
  }, [setRecords]);

  const syncNow = useCallback(async () => {
    if (!cloudConfigured) return;
    if (running.current) { runAgain.current = true; return; }
    running.current = true;
    try {
      do {
        runAgain.current = false;
        if (!navigator.onLine) { setStatus("offline"); return; }
        try {
          await cycle();
          hasSynced.current = true;
          setLastSyncedAt(Date.now());
          setStatus(pendingRecords(recordsRef.current, stateRef.current.known).length ? "syncing" : "synced");
        } catch {
          setStatus("offline");
          return;
        }
      } while (runAgain.current);
    } finally {
      running.current = false;
    }
  }, [cycle]);

  // Track the latest records and push local edits shortly after they happen.
  useEffect(() => {
    recordsRef.current = records;
    if (!cloudConfigured || !pendingRecords(records, stateRef.current.known).length) return;
    if (hasSynced.current && navigator.onLine) setStatus("syncing");
    const timer = window.setTimeout(() => { void syncNow(); }, PUSH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [records, syncNow]);

  // Pull on start, on a steady interval, and whenever the app returns to the foreground or comes back online.
  useEffect(() => {
    if (!cloudConfigured) return;
    void syncNow();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void syncNow(); };
    const onOnline = () => { void syncNow(); };
    const onOffline = () => setStatus("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [syncNow]);

  const pendingCount = cloudConfigured ? pendingRecords(records, stateRef.current.known).length : 0;
  return { status, lastSyncedAt, pendingCount, syncNow };
}
