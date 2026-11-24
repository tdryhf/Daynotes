// Public connection details for the shared Daybook backend (the "daynotes" Supabase project).
//
// Both values are designed to be public: Vite embeds them in the browser bundle anyway, and the
// publishable key can only do what the database's row-level security and API functions allow
// (see supabase/schema.sql). They are committed as defaults so every deployment — production and
// preview — is connected without extra setup. This file has no browser- or Vite-only code, so the
// server functions in api/ can use it too.
//
// Never put a Supabase service-role/secret key here or in any VITE_ variable.
export const DEFAULT_SUPABASE_URL = "https://prhjlqbhbjjugygyxuja.supabase.co";
export const DEFAULT_SUPABASE_KEY = "sb_publishable_3Sq__T3jQ-kA-5ED2ICNIg_R8dcuCJa";
