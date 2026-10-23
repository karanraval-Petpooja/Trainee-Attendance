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

// Data-usage meter: adds up the data this device receives from Supabase (≈ Supabase "egress")
// and reports it about once a minute, so managers can be warned before the monthly limit.
let pendingBytes = 0;
let flushTimer = null;
function countBytes(res) {
  try {
    const len = Number(res.headers.get('content-length'));
    if (len > 0) { pendingBytes += len; return; }
    res.clone().arrayBuffer().then((b) => { pendingBytes += b.byteLength; }).catch(() => {});
  } catch { /* never get in the way of the app */ }
}
async function flushEgress() {
  if (!pendingBytes || !client) return;
  const bytes = pendingBytes; pendingBytes = 0;
  try { await client.rpc('add_egress', { p_bytes: bytes }); } catch { /* a missed report only makes the estimate slightly lower */ }
}
const meteredFetch = async (input, init) => {
  const res = await fetch(input, init);
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!url.includes('/rpc/add_egress')) countBytes(res);
  return res;
};

export function sb() {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: meteredFetch },
    });
    if (isBrowser() && !flushTimer) {
      flushTimer = setInterval(flushEgress, 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushEgress(); });
    }
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
