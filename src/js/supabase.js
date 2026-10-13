/**
 * ================================================================================
 * IqwanEngine - Core System Architecture
 * Module: Supabase Client & Realtime Broadcast Controller
 * Architecture: Cross-Environment Localhost & Vercel Deployment
 * ================================================================================
 */

import { createClient } from "@supabase/supabase-js";

// Dynamically load Supabase credentials from environment variables
export const SUPABASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
  "";

export const SUPABASE_ANON_KEY =
  (typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== "undefined" && process.env?.VITE_SUPABASE_ANON_KEY) ||
  "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "IqwanEngine: Missing Supabase credentials! Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Dedicated unauthenticated client instance to guarantee public / seed gateway availability
export const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

let realtimeChannel = null;
let realtimeStatus = "CONNECTING";
const statusListeners = new Set();

export function getRealtimeStatus() {
  return realtimeStatus;
}

export function onRealtimeStatusChange(fn) {
  statusListeners.add(fn);
  fn(realtimeStatus);
  return () => statusListeners.delete(fn);
}

function notifyStatus(status) {
  realtimeStatus = status;
  statusListeners.forEach((fn) => {
    try {
      fn(status);
    } catch (err) {
      console.warn("Status listener error:", err);
    }
  });
}

const clientListeners = new Set();

/**
 * Berlangganan perubahan Realtime pada tabel clients
 * @param {Function} onUpdateCallback - Handler saat ada baris yang diperbarui/ditambahkan
 * @returns {Function} Unsubscribe function
 */
export function subscribeToClientUpdates(onUpdateCallback) {
  if (typeof onUpdateCallback === "function") {
    clientListeners.add(onUpdateCallback);
  }

  if (!realtimeChannel) {
    notifyStatus("CONNECTING");

    realtimeChannel = supabase
      .channel("public:clients")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clients" },
        (payload) => {
          clientListeners.forEach((fn) => {
            try {
              fn(payload);
            } catch (err) {
              console.warn("Client listener callback error:", err);
            }
          });
        },
      )
      .subscribe((status) => {
        notifyStatus(status);
      });
  }

  return () => {
    clientListeners.delete(onUpdateCallback);
  };
}
