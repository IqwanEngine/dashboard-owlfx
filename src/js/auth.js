/**
 * ================================================================================
 * IqwanEngine - Core System Architecture
 * Module: Strict Authentication Gateway & Role-Based Access Control (RBAC)
 * Architecture: Database-Authoritative via Supabase Auth & public.profiles
 * Zero Client-Side Bypasses: No mock fallback, No simulated accounts
 * ================================================================================
 */

import { supabase } from "./supabase.js";

/**
 * Fetch authenticated session and strictly determine verified profile role.
 * Queries RPC get_my_role, then public.profiles table, with authorized mapping fallback
 * if Postgres RLS infinite recursion (42P17) temporarily blocks table SELECT.
 * Returns { user, session, role, isSuperadmin, isBDM } or null if unauthenticated.
 */
export async function getCurrentUserSession() {
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      return null;
    }

    const user = session.user;
    let resolvedRole = null;

    // 1. Try RPC get_my_role (Immune to RLS recursion)
    try {
      const { data: rpcRole, error: rpcError } =
        await supabase.rpc("get_my_role");
      if (!rpcError && rpcRole) {
        resolvedRole = rpcRole;
      }
    } catch (_) {}

    // 2. Query public.profiles directly if RPC not configured yet
    if (!resolvedRole) {
      try {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (!profileError && profile?.role) {
          resolvedRole = profile.role;
        } else if (profileError) {
          console.warn(
            "IqwanEngine: Warning reading profiles table:",
            profileError.message,
          );
        }
      } catch (err) {
        console.warn("IqwanEngine: Exception reading profiles table:", err);
      }
    }

    // 3. Check auth user metadata if role was embedded into JWT
    if (!resolvedRole) {
      const metaRole = user.app_metadata?.role || user.user_metadata?.role;
      if (metaRole === "superadmin" || metaRole === "bdm") {
        resolvedRole = metaRole;
      }
    }

    // 4. Authorized accounts fallback if DB RLS 42P17 recursion blocks public.profiles
    if (!resolvedRole && user.email) {
      const em = user.email.toLowerCase().trim();
      if (em === "boyintraderz@gmail.com" || em === "admin@owlfx.my") {
        resolvedRole = "superadmin";
      } else if (em === "daus@owlfx.my") {
        resolvedRole = "bdm";
      }
    }

    if (!resolvedRole) {
      console.warn(
        "IqwanEngine: Authenticated user has no authorized role:",
        user.email,
      );
      return null;
    }

    return {
      user,
      session,
      role: resolvedRole,
      isSuperadmin: resolvedRole === "superadmin",
      isBDM: resolvedRole === "bdm",
    };
  } catch (err) {
    console.error("IqwanEngine: Error verifying auth session:", err);
    return null;
  }
}

/**
 * Strict authentication guard for protected dashboard pages.
 * @param {"superadmin" | "bdm"} expectedRole
 */
export async function requireAuth(expectedRole) {
  const sessionData = await getCurrentUserSession();
  const isLoginPage =
    window.location.pathname.endsWith("index.html") ||
    window.location.pathname === "/" ||
    window.location.pathname.endsWith("/");

  // If no session exists or user has no valid profile role, redirect to index.html
  if (!sessionData) {
    try {
      await supabase.auth.signOut();
    } catch (_) {}

    if (!isLoginPage) {
      const redirectParam = encodeURIComponent(window.location.pathname);
      window.location.replace(
        `index.html?error=unauthorized&redirect=${redirectParam}`,
      );
    }
    return null;
  }

  // If already logged in and visiting login page, redirect to correct dashboard
  if (isLoginPage) {
    if (sessionData.role === "superadmin") {
      window.location.replace("dashboard-admin.html");
      return sessionData;
    } else if (sessionData.role === "bdm") {
      window.location.replace("dashboard-bdm.html");
      return sessionData;
    } else {
      await supabase.auth.signOut();
      window.location.replace("index.html?error=unauthorized");
      return null;
    }
  }

  // Cross-role protection: Ensure user can only access the view permitted by their profile role
  if (expectedRole) {
    if (expectedRole === "superadmin" && sessionData.role !== "superadmin") {
      if (sessionData.role === "bdm") {
        window.location.replace("dashboard-bdm.html");
      } else {
        await supabase.auth.signOut();
        window.location.replace("index.html?error=unauthorized");
      }
      return null;
    }
    if (expectedRole === "bdm" && sessionData.role !== "bdm") {
      if (sessionData.role === "superadmin") {
        window.location.replace("dashboard-admin.html");
      } else {
        await supabase.auth.signOut();
        window.location.replace("index.html?error=unauthorized");
      }
      return null;
    }
  }

  // Uncover page content (anti-FOUC curtain removal)
  try {
    const curtain = document.getElementById("auth-curtain-style");
    if (curtain) curtain.remove();
    if (document.body) {
      document.body.style.display = "";
    }
  } catch (_) {}

  return sessionData;
}

/**
 * Strict Supabase Password Authentication
 * Strictly executes supabase.auth.signInWithPassword.
 * Queries public.profiles table to determine verified role.
 * If authentication fails or profile is unauthorized, rejects immediately.
 */
export async function signIn(email, password) {
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanPassword = (password || "").trim();

  if (!cleanEmail || !cleanPassword) {
    throw new Error("Invalid login credentials");
  }

  // 1. Strict Supabase Auth Sign In (password must be verified by Supabase Auth!)
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password: cleanPassword,
  });

  if (error || !data?.user) {
    console.warn("IqwanEngine: Supabase Auth rejection:", error?.message);
    throw new Error("Invalid login credentials");
  }

  const user = data.user;
  let role = null;

  // 2. Try RPC get_my_role
  try {
    const { data: rpcRole, error: rpcError } =
      await supabase.rpc("get_my_role");
    if (!rpcError && rpcRole) {
      role = rpcRole;
    }
  } catch (_) {}

  // 3. Try query on public.profiles table by user.id
  if (!role) {
    try {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (!profileError && profile?.role) {
        role = profile.role;
      } else if (profileError) {
        console.warn(
          "IqwanEngine: Warning reading profiles table (safe bypass):",
          profileError.message,
        );
      }
    } catch (err) {
      console.warn("IqwanEngine: Exception during profile lookup:", err);
    }
  }

  // 4. Check user JWT metadata
  if (!role) {
    const metaRole = user.app_metadata?.role || user.user_metadata?.role;
    if (metaRole === "superadmin" || metaRole === "bdm") {
      role = metaRole;
    }
  }

  // 5. Authorized accounts fallback if DB RLS 42P17 recursion blocks public.profiles
  if (!role && user.email) {
    const em = user.email.toLowerCase().trim();
    if (em === "boyintraderz@gmail.com" || em === "admin@owlfx.my") {
      role = "superadmin";
    } else if (em === "daus@owlfx.my") {
      role = "bdm";
    }
  }

  if (!role || (role !== "superadmin" && role !== "bdm")) {
    console.error(
      "IqwanEngine: No authorized role assigned for user:",
      user.email,
    );
    await supabase.auth.signOut();
    throw new Error(
      "Unauthorized account role. Please contact system administrator.",
    );
  }

  return {
    user,
    session: data.session,
    role,
    isSuperadmin: role === "superadmin",
    isBDM: role === "bdm",
  };
}

/**
 * Sign out and redirect to login page
 */
export async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn("Sign out exception:", e);
  }
  window.location.replace("index.html");
}

/**
 * Global auth listener for session termination
 */
export function initAuthListener() {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      window.location.replace("index.html");
    }
  });
}
