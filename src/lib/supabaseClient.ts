import { APP_SCHEMA, getSupabaseConfig } from "./runtimeConfig.ts";

let clientPromise = null;

export async function getSupabaseClient() {
  if (clientPromise) return clientPromise;
  clientPromise = import("https://esm.sh/@supabase/supabase-js@2.49.1").then(({ createClient }) => {
    const config = getSupabaseConfig();
    return createClient(config.url, config.anonKey, {
      auth: {
        storageKey: config.authStorageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      db: {
        schema: APP_SCHEMA,
      },
      global: {
        headers: {
          "X-Client-Info": "app687-cryptotax-sweden",
        },
      },
    });
  });
  return clientPromise;
}

export async function getAccessToken() {
  const client = await getSupabaseClient();
  const { data } = await client.auth.getSession();
  return data && data.session ? data.session.access_token : "";
}
