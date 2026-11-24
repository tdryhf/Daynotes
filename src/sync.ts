import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppRecord } from "./types";
import type { JournalEnvelope } from "./journalVault";
import { supabaseKey, supabaseUrl } from "./config";

export const cloudConfigured = Boolean(supabaseUrl && supabaseKey);

const REQUEST_TIMEOUT_MS = 45_000;
/** Gives up on a request that hangs (e.g. on a captive or flaky network) so the next retry can run. */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const signals = [init?.signal, typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined].filter(Boolean) as AbortSignal[];
  const signal = signals.length > 1 && typeof AbortSignal.any === "function" ? AbortSignal.any(signals) : signals[0];
  return fetch(input, { ...init, signal });
};

const client: SupabaseClient | null = cloudConfigured ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: fetchWithTimeout },
}) : null;

const PAGE_SIZE = 1000;
const PUSH_CHUNK = 400;
/** Re-read a short window before the cursor so rows committed slightly out of order are never missed. */
const PULL_OVERLAP_MS = 2 * 60_000;

function requireClient() {
  if (!client) throw new Error("Cloud sync is not configured.");
  return client;
}

/** Quotes a value for a PostgREST filter so characters like `,` `.` `:` and `()` are read literally. */
const quoted = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const isRecord = (value: unknown): value is AppRecord =>
  Boolean(value) && typeof value === "object" && typeof (value as AppRecord).id === "string" && typeof (value as AppRecord).type === "string" && typeof (value as AppRecord).updatedAt === "number";

/**
 * Reads shared records changed since `cursor` (or everything when no cursor). Pages are fetched by
 * position in (updated_at, id) order rather than by offset, so the API's per-request row cap never
 * hides records, even when other devices write while a large first pull is under way.
 */
export async function pullCloudRecords(cursor?: string): Promise<{ records: AppRecord[]; cursor?: string }> {
  const db = requireClient();
  const cursorMs = cursor ? Date.parse(cursor) : Number.NaN;
  const since = Number.isNaN(cursorMs) ? undefined : new Date(cursorMs - PULL_OVERLAP_MS).toISOString();
  const records: AppRecord[] = [];
  let nextCursor = cursor;
  let after: { updatedAt: string; id: string } | undefined;
  for (;;) {
    let query = db.from("family_records").select("id, record, updated_at")
      .order("updated_at", { ascending: true }).order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (since) query = query.gt("updated_at", since);
    if (after) query = query.or(`updated_at.gt.${quoted(after.updatedAt)},and(updated_at.eq.${quoted(after.updatedAt)},id.gt.${quoted(after.id)})`);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string; record: unknown; updated_at: string }>;
    for (const row of rows) {
      if (isRecord(row.record)) records.push(row.record);
      if (typeof row.updated_at === "string" && (!nextCursor || Date.parse(row.updated_at) > Date.parse(nextCursor))) nextCursor = row.updated_at;
    }
    if (rows.length < PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    after = { updatedAt: last.updated_at, id: last.id };
  }
  return { records, cursor: nextCursor };
}

/** Asks the server for its current time, with this device's clock readings either side of the request. */
export async function readServerTime() {
  const db = requireClient();
  const sentAt = Date.now();
  const { data, error } = await db.rpc("server_now_ms");
  const receivedAt = Date.now();
  if (error) throw error;
  return { serverMs: Number(data), sentAt, receivedAt };
}

/**
 * Sends records to the shared store. The server keeps whichever copy of each record was edited last,
 * and pulls any edit time later than its own clock back to the current time.
 */
export async function pushCloudRecords(records: AppRecord[]) {
  const db = requireClient();
  const shareable = records.filter((record) => record.type !== "journal");
  for (let index = 0; index < shareable.length; index += PUSH_CHUNK) {
    const { error } = await db.rpc("push_family_records", { payload: shareable.slice(index, index + PUSH_CHUNK) });
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Private journal. Everything sent here is already encrypted in the browser.

export type StoredJournal = { envelope: JournalEnvelope; version: number };
export type JournalWriteResult = { status: "ok"; version: number } | { status: "conflict"; version: number } | { status: "exists" | "missing" | "forbidden" | "invalid" };

export async function readJournal(): Promise<StoredJournal | null> {
  const { data, error } = await requireClient().from("private_journal").select("envelope, version").eq("id", "shared").maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { envelope: data.envelope as JournalEnvelope, version: Number(data.version) };
}

export async function readJournalVersion(): Promise<number | null> {
  const { data, error } = await requireClient().from("private_journal").select("version").eq("id", "shared").maybeSingle();
  if (error) throw error;
  return data ? Number(data.version) : null;
}

const asWriteResult = (value: unknown): JournalWriteResult => {
  const result = (value ?? {}) as { status?: string; version?: number | string };
  if (result.status === "ok" || result.status === "conflict") return { status: result.status, version: Number(result.version) };
  if (result.status === "exists" || result.status === "missing" || result.status === "forbidden" || result.status === "invalid") return { status: result.status };
  throw new Error("Journal storage returned an unexpected response.");
};

export async function createJournal(envelope: JournalEnvelope, writeToken: string) {
  const { data, error } = await requireClient().rpc("journal_create", { p_envelope: envelope, p_write_token: writeToken });
  if (error) throw error;
  return asWriteResult(data);
}

export async function saveJournal(expectedVersion: number, envelope: JournalEnvelope, writeToken: string) {
  const { data, error } = await requireClient().rpc("journal_save", { p_expected_version: expectedVersion, p_envelope: envelope, p_write_token: writeToken });
  if (error) throw error;
  return asWriteResult(data);
}

export async function uploadJournalPhoto(writeToken: string, id: string, iv: string, ciphertext: string) {
  const { data, error } = await requireClient().rpc("journal_put_photo", { p_write_token: writeToken, p_id: id, p_iv: iv, p_ciphertext: ciphertext });
  if (error) throw error;
  const status = (data as { status?: string } | null)?.status;
  if (status !== "ok") throw new Error(status === "forbidden" ? "This journal no longer accepts changes from this device. Lock and unlock it again." : "The photo could not be stored.");
}

export async function deleteJournalPhotos(writeToken: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await requireClient().rpc("journal_delete_photos", { p_write_token: writeToken, p_ids: ids });
  if (error) throw error;
}

export async function readJournalPhotos(ids: string[]): Promise<Array<{ id: string; iv: string; ciphertext: string }>> {
  const rows: Array<{ id: string; iv: string; ciphertext: string }> = [];
  for (let index = 0; index < ids.length; index += 25) {
    const { data, error } = await requireClient().from("private_journal_photos").select("id, iv, ciphertext").in("id", ids.slice(index, index + 25));
    if (error) throw error;
    rows.push(...(data ?? []) as Array<{ id: string; iv: string; ciphertext: string }>);
  }
  return rows;
}
