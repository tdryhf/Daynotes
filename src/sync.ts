import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppRecord } from "./types";
import type { JournalEnvelope } from "./journalVault";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const cloudConfigured = Boolean(url && anonKey);
const client: SupabaseClient | null = cloudConfigured ? createClient(url!, anonKey!, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

export async function readCloudRecords(): Promise<AppRecord[]> {
  if (!client) return [];
  const { data, error } = await client.from("family_records").select("record");
  if (error) throw error;
  return (data ?? []).map((row) => row.record as AppRecord);
}

export async function writeCloudRecords(records: AppRecord[]) {
  if (!client || records.length === 0) return;
  const privateFreeRecords = records.filter((record) => record.type !== "journal");
  if (privateFreeRecords.length === 0) return;
  const rows = privateFreeRecords.map((record) => ({
    id: record.id,
    record,
    updated_at: new Date(record.updatedAt).toISOString(),
  }));
  const { error } = await client.from("family_records").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export async function readPrivateJournal(): Promise<JournalEnvelope | null> {
  if (client) {
    const { data, error } = await client.from("private_journal").select("envelope").eq("id", "shared").maybeSingle();
    if (error) throw error;
    return (data?.envelope as JournalEnvelope | undefined) ?? null;
  }
  const response = await fetch("/api/private-journal", { headers: { Accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not reach the private journal on this device’s local server.");
  const data = await response.json() as { envelope?: JournalEnvelope };
  return data.envelope ?? null;
}

export async function writePrivateJournal(envelope: JournalEnvelope) {
  if (client) {
    const { error } = await client.from("private_journal").upsert({
      id: "shared",
      envelope,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) throw error;
    return;
  }
  const response = await fetch("/api/private-journal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envelope }) });
  if (!response.ok) throw new Error("The local journal server could not save this page.");
}
