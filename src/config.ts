// Public connection details for the shared Daybook backend (the "daynotes" Supabase project).
//
// Both values are designed to be public: Vite embeds them in the browser bundle anyway, and the
// publishable key can only do what the database's row-level security and API functions allow
// (see supabase/schema.sql). They are committed as defaults so every deployment — production and
// preview — is connected without extra setup. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in the
// hosting environment (or .env.local) to point a build at a different project.
//
// Never put a Supabase service-role/secret key here or in any VITE_ variable.
const DEFAULT_SUPABASE_URL = "https://prhjlqbhbjjugygyxuja.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_3Sq__T3jQ-kA-5ED2ICNIg_R8dcuCJa";

const fromEnv = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

export const supabaseUrl = fromEnv(import.meta.env.VITE_SUPABASE_URL) ?? DEFAULT_SUPABASE_URL;
export const supabaseKey = fromEnv(import.meta.env.VITE_SUPABASE_ANON_KEY) ?? DEFAULT_SUPABASE_KEY;
