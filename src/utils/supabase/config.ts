const SUPABASE_PLACEHOLDER_URL = "https://example.com";
const SUPABASE_PLACEHOLDER_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJwYXdmaW5kZXIiLCJyb2xlIjoiYW5vbiJ9.placeholder";

let hasWarnedMissingPublicSupabaseConfig = false;

export function isSupabasePublicEnvConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  );
}

export function getSupabasePublicEnv() {
  if (isSupabasePublicEnvConfigured()) {
    return {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
      isConfigured: true,
    };
  }

  if (!hasWarnedMissingPublicSupabaseConfig) {
    hasWarnedMissingPublicSupabaseConfig = true;
    console.warn(
      "[supabase-config] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Running in degraded mode."
    );
  }

  return {
    url: SUPABASE_PLACEHOLDER_URL,
    anonKey: SUPABASE_PLACEHOLDER_ANON_KEY,
    isConfigured: false,
  };
}
