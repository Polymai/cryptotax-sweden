import { getSupabaseClient } from "../lib/supabaseClient.js";

export const TABLES = Object.freeze({
  profiles: "profiles",
  pricingPlans: "pricing_plans",
  taxYears: "tax_years",
  binanceConnections: "binance_connections",
  openingBalances: "opening_balances",
  importJobs: "import_jobs",
  transactions: "transactions",
  costBasisRecoveries: "cost_basis_recoveries",
  taxReports: "tax_reports",
  payments: "payments",
  entitlements: "entitlements",
  connectAccounts: "connect_accounts",
});

export async function upsertProfile(profile) {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("profiles")
    .upsert(profile, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getProfile(userId) {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPricingPlans() {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("pricing_plans")
    .select("*")
    .eq("active", true)
    .order("price_amount", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listTaxYears() {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("tax_years").select("*").order("tax_year", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getTaxYearByYear(taxYear) {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("tax_years").select("*").eq("tax_year", Number(taxYear)).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createOrUpdateTaxYear(payload) {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("tax_years")
    .upsert(payload, { onConflict: "owner_user_id,tax_year" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listTransactions(taxYearId) {
  const client = await getSupabaseClient();
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("transactions")
      .select("*")
      .eq("tax_year_id", taxYearId)
      .order("traded_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function listReports() {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("tax_reports")
    .select("*, tax_years(tax_year,status)")
    .order("generated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getLatestReportForTaxYear(taxYearId) {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("tax_reports")
    .select("*")
    .eq("tax_year_id", taxYearId)
    .order("generated_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

export async function listBinanceConnections() {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("binance_connections")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
}

export async function listOpeningBalances(taxYearId) {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("opening_balances")
    .select("*")
    .eq("tax_year_id", taxYearId)
    .order("asset_symbol", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listImportJobs(taxYearId) {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("import_jobs")
    .select("*")
    .eq("tax_year_id", taxYearId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function listPayments() {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("payments").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listEntitlements() {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("entitlements").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getConnectAccount() {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("connect_accounts").select("*").maybeSingle();
  if (error) throw error;
  return data;
}
