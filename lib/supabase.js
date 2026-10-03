'use client';
import { createClient } from '@supabase/supabase-js';

let client = null;
const isBrowser = () => typeof window !== 'undefined';

// "Remember me" → session in localStorage; otherwise sessionStorage (cleared when the browser closes)
const storage = {
  getItem: (k) => (isBrowser() ? window.localStorage.getItem(k) ?? window.sessionStorage.getItem(k) : null),
  setItem: (k, v) => {
    if (!isBrowser()) return;
    const remember = window.localStorage.getItem('ta_remember') !== '0';
    (remember ? window.localStorage : window.sessionStorage).setItem(k, v);
    (remember ? window.sessionStorage : window.localStorage).removeItem(k);
  },
  removeItem: (k) => {
    if (!isBrowser()) return;
    window.localStorage.removeItem(k);
    window.sessionStorage.removeItem(k);
  },
};

export function sb() {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

// Calls our own API routes with the signed-in user's token
export async function authFetch(url, options = {}) {
  const { data } = await sb().auth.getSession();
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}
