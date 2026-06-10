import { getSupabaseConfig } from "./runtimeConfig.ts";

function scopedKey(key) {
  const prefix = getSupabaseConfig().appStoragePrefix || "polymai:app687:";
  return `${prefix}${key}`;
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(scopedKey(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  storage.setItem(scopedKey(key), JSON.stringify(value));
}

export const appStorage = {
  key: scopedKey,
  getLocal(key, fallback = null) {
    return readJson(window.localStorage, key, fallback);
  },
  setLocal(key, value) {
    writeJson(window.localStorage, key, value);
  },
  removeLocal(key) {
    window.localStorage.removeItem(scopedKey(key));
  },
  getSession(key, fallback = null) {
    return readJson(window.sessionStorage, key, fallback);
  },
  setSession(key, value) {
    writeJson(window.sessionStorage, key, value);
  },
  removeSession(key) {
    window.sessionStorage.removeItem(scopedKey(key));
  },
};
