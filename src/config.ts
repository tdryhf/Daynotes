import { DEFAULT_SUPABASE_KEY, DEFAULT_SUPABASE_URL } from "./supabaseDefaults";

// Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in the hosting environment (or .env.local) to point
// a build at a different project; otherwise the shared defaults in supabaseDefaults.ts are used.
const fromEnv = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

export const supabaseUrl = fromEnv(import.meta.env.VITE_SUPABASE_URL) ?? DEFAULT_SUPABASE_URL;
export const supabaseKey = fromEnv(import.meta.env.VITE_SUPABASE_ANON_KEY) ?? DEFAULT_SUPABASE_KEY;
