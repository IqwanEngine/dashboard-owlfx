/**
 * ================================================================================
 * IqwanEngine - Core System Architecture
 * Module: Authentication Gateway & Role-Based Access Control (RBAC)
 * ================================================================================
 */

import { supabase } from "./supabase.js";

const SUPERADMIN_EMAIL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPERADMIN_EMAIL) ||
  (typeof process !== "undefined" && process.env?.VITE_SUPERADMIN_EMAIL) ||
  "";

const BDM_EMAIL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BDM_EMAIL) ||
  (typeof process !== "undefined" && process.env?.VITE_BDM_EMAIL) ||
  "";

export function getRoleDefaultEmail(role) {
  if (role === "admin" || role === "superadmin") {
    return SUPERADMIN_EMAIL;
  }
  return BDM_EMAIL;
}

if (typeof window !== "undefined") {
  window.getRoleDefaultEmail = getRoleDefaultEmail;
}

/**
 * Mendapatkan sesi dan data role pengguna aktif
 */
export async function getCurrentUserSession() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session) return null;

  const user = session.user;

  // Ambil data role dari tabel profiles
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  let resolvedRole = profile?.role;

  // Fallback verifikasi email primer jika profil belum terpropagasi
  if (!resolvedRole) {
    if (user.email === SUPERADMIN_EMAIL) resolvedRole = "superadmin";
    else if (user.email === BDM_EMAIL) resolvedRole = "bdm";
    else resolvedRole = "bdm";
  }

  return {
    user,
    role: resolvedRole,
    isSuperadmin: resolvedRole === "superadmin",
    isBDM: resolvedRole === "bdm",
  };
}

/**
 * Guard untuk dashboard.html: Lempar ke index.html jika tidak login
 */
export async function requireAuth(expectedRole) {
  const sessionData = await getCurrentUserSession();
  const isLoginPage =
    window.location.pathname.endsWith("index.html") ||
    window.location.pathname === "/" ||
    window.location.pathname.endsWith("/");

  if (!sessionData && !isLoginPage) {
    window.location.replace("index.html");
    return null;
  }

  if (sessionData && isLoginPage) {
    const targetDashboard =
      sessionData.role === "superadmin" || sessionData.role === "admin"
        ? "dashboard-admin.html"
        : "dashboard-bdm.html";
    window.location.replace(targetDashboard);
    return sessionData;
  }

  return sessionData;
}

/**
 * Autentikasi login menggunakan Email dan Password
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password: password,
  });

  if (error) throw error;
  return data;
}

/**
 * Logout dan pengalihan ke halaman index.html
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error("Sign out error:", error.message);
  window.location.replace("index.html");
}

/**
 * Listener perubahan sesi global
 */
export function initAuthListener() {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      window.location.replace("index.html");
    }
  });
}
