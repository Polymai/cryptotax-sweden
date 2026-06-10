import { buildAuthRedirectUrl } from "../lib/runtimeConfig.ts";
import { getSupabaseClient } from "../lib/supabaseClient.ts";
import { getProfile, upsertProfile } from "../api/db.ts";

const listeners = new Set();

let state = {
  status: "idle",
  session: null,
  user: null,
  profile: null,
  error: "",
};

function emit() {
  for (const listener of listeners) listener({ ...state });
}

function setState(next) {
  state = { ...state, ...next };
  emit();
}

async function loadProfileForUser(user) {
  if (!user?.id) {
    setState({ profile: null });
    return null;
  }
  try {
    const profile = await getProfile(user.id);
    setState({ profile, error: "" });
    return profile;
  } catch (error) {
    setState({ profile: null, error: error.message || "Profile unavailable." });
    return null;
  }
}

export function subscribeAuth(listener) {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

export function getAuthSnapshot() {
  return { ...state };
}

export async function initAuthState() {
  try {
    setState({ status: "loading", error: "" });
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data.session || null;
    setState({ status: "ready", session, user: session ? session.user : null });
    client.auth.onAuthStateChange((_event, nextSession) => {
      setState({
        status: "ready",
        session: nextSession,
        user: nextSession ? nextSession.user : null,
        profile: nextSession ? state.profile : null,
      });
      if (nextSession?.user) void loadProfileForUser(nextSession.user);
    });
    if (session?.user) await loadProfileForUser(session.user);
    return session;
  } catch (error) {
    setState({ status: "error", error: error.message || "Auth unavailable." });
    return null;
  }
}

export async function signInWithPassword(email, password) {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(mapAuthError(error.message));
  setState({ status: "ready", session: data.session, user: data.user, error: "" });
  if (data.user) await loadProfileForUser(data.user);
  return data;
}

export async function signUpWithPassword(email, password, displayName) {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: buildAuthRedirectUrl(),
      data: {
        display_name: displayName,
        app_id: "app687",
      },
    },
  });
  if (error) throw new Error(mapAuthError(error.message));
  setState({ status: "ready", session: data.session, user: data.user, error: "" });
  if (data.user) {
    await completeAppProfile({
      userId: data.user.id,
      email,
      displayName,
    });
  }
  return data;
}

export async function completeAppProfile({ userId, email, displayName, appSettings }) {
  const language = appSettings?.language === "sv" ? "sv" : "en";
  const currentSettings =
    state.profile?.app_settings && typeof state.profile.app_settings === "object" ? state.profile.app_settings : {};
  const profile = await upsertProfile({
    user_id: userId,
    email,
    display_name: displayName || email,
    onboarding_status: "active",
    tax_residency: "SE",
    app_settings: {
      ...currentSettings,
      stablecoin_cost_basis_fallback: appSettings?.stablecoin_cost_basis_fallback !== false,
      language,
    },
  });
  setState({ profile, error: "" });
  return profile;
}

export async function signOut() {
  const client = await getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  setState({ status: "ready", session: null, user: null, profile: null, error: "" });
}

function mapAuthError(message) {
  const value = String(message || "");
  if (/already|registered|exists|duplicate/i.test(value)) {
    return "This email may already work for sign-in. Sign in instead, or reset your password.";
  }
  if (/invalid login|credentials/i.test(value)) {
    return "The email or password did not match.";
  }
  return value || "Authentication failed.";
}
