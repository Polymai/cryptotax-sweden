export const APP_ID = "app687";
export const APP_NAME = "CryptoTax Sweden";
export const APP_SCHEMA = "app687_cryptotax";
export const APP_FUNCTION_PREFIX = "app687-cryptotax-sweden";

export function getSupabaseConfig() {
  const config = window.__POLYMAI_SUPABASE_CONFIG__ || window.__SUPABASE_CONFIG__;
  if (!config || !config.url || !config.anonKey) {
    throw new Error("Supabase runtime config is missing.");
  }
  return config;
}

export function getStripeConfig() {
  return window.__POLYMAI_STRIPE_CONFIG__ || {
    mode: "test",
    publishableKey: "",
    connectClientId: "",
    stripeConnectClientId: "",
    functionsBaseUrl: getSupabaseConfig().functionsBaseUrl,
    defaultSuccessUrl: "",
    defaultCancelUrl: "",
    defaultPriceIds: [],
  };
}

export function getFunctionsBaseUrl() {
  const supabase = getSupabaseConfig();
  return supabase.functionsBaseUrl || `${supabase.url.replace(/\/+$/, "")}/functions/v1`;
}

export function getSiteUrl() {
  const config = getSupabaseConfig();
  return config.siteUrl || window.location.origin + window.location.pathname;
}

export function buildAuthRedirectUrl() {
  return getSiteUrl().replace(/#.*$/, "");
}
