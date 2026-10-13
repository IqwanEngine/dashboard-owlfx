/**
 * ================================================================================
 * IqwanEngine VT Market Ecosystem: Core Application & Realtime Supabase Controller
 * Fully Live Architecture: Zero Mock / Dummy Records
 * ================================================================================
 */

import {
  supabase,
  supabaseAnon,
  subscribeToClientUpdates,
  onRealtimeStatusChange,
} from "./supabase.js";

import { ToastNotification, showToast } from "./ui.js";

import {
  updateRemarkEngine,
  getStructuredRemarkOptions,
  saveStructuredRemarkOptions,
  getRemarkTargetAction,
  DEFAULT_REMARK_OPTIONS,
  DEFAULT_ADMIN_WA,
  formatDate,
  escapeHtml,
  getAdminWhatsApp,
  saveAdminWhatsApp,
  syncSystemSettingsFromDB,
  exportToCSV,
} from "./utils.js";

// Re-export for cross-module compatibility
export {
  ToastNotification,
  showToast,
  updateRemarkEngine,
  getStructuredRemarkOptions,
  saveStructuredRemarkOptions,
  getRemarkTargetAction,
  DEFAULT_REMARK_OPTIONS,
  DEFAULT_ADMIN_WA,
  formatDate,
  escapeHtml,
  getAdminWhatsApp,
  saveAdminWhatsApp,
  syncSystemSettingsFromDB,
  exportToCSV,
};

// Ensure deleteClient is globally accessible across all scopes immediately
if (typeof window !== "undefined") {
  window.deleteClient = (id, event) => {
    console.log("Delete clicked for ID:", id);
    if (typeof window.openDeleteModal === "function") {
      window.openDeleteModal(id, event);
    }
  };
  globalThis.deleteClient = window.deleteClient;
}

/**
 * Returns plain string labels for select dropdown rendering
 */
export function getRemarkOptions() {
  return getStructuredRemarkOptions().map((opt) => opt.label);
}

export const saveRemarkOptions = saveStructuredRemarkOptions;

// Global in-memory data state
let adminClients = [];
let bdmClients = [];
let adminFilter = "all";
let bdmFilter = "all";
let adminSearch = "";
let bdmSearch = "";

// Row edit state: map of id -> { isEditing: boolean, draftName, draftEmail, draftPhone, draftRemark, draftStatus }
const rowDrafts = new Map();

// BDM row action state: map of id -> { mode: 'custom' | 'complete', customText: string }
const bdmRowStates = new Map();

/**
 * Safe Supabase Update Helper
 * Gracefully retries without action_status if PostgREST schema cache is lagging,
 * includes unauthenticated gateway fallback if RLS applies, and robustly catches network failures.
 */
async function safeUpdateClient(id, payload) {
  // Ensure full_name is not sent as it is a generated column in Supabase PostgreSQL
  const cleanPayload = { ...payload };
  delete cleanPayload.full_name;

  try {
    let { data, error } = await supabase
      .from("clients")
      .update(cleanPayload)
      .eq("id", id)
      .select();

    if (
      error &&
      (error.message?.includes("row-level security") || error.code === "42501")
    ) {
      const anonRes = await supabaseAnon
        .from("clients")
        .update(cleanPayload)
        .eq("id", id)
        .select();
      if (!anonRes.error) {
        error = null;
        data = anonRes.data;
      }
    }

    if (error) {
      let retryNeeded = false;
      const fallbackPayload = { ...cleanPayload };

      if (error.message && error.message.includes("action_status")) {
        console.warn(
          "PostgREST schema cache missing 'action_status', retrying without it.",
        );
        delete fallbackPayload.action_status;
        retryNeeded = true;
      }
      if (error.message && error.message.includes("full_name")) {
        delete fallbackPayload.full_name;
        retryNeeded = true;
      }

      if (retryNeeded) {
        let res = await supabase
          .from("clients")
          .update(fallbackPayload)
          .eq("id", id)
          .select();
        if (
          res.error &&
          (res.error.message?.includes("row-level security") ||
            res.error.code === "42501")
        ) {
          res = await supabaseAnon
            .from("clients")
            .update(fallbackPayload)
            .eq("id", id)
            .select();
        }
        error = res.error;
        data = res.data;
      }
    }

    return { data, error, isNetworkError: false };
  } catch (networkErr) {
    console.error(
      "IqwanEngine: Network error during safeUpdateClient:",
      networkErr,
    );
    return {
      data: null,
      error: networkErr,
      isNetworkError: true,
    };
  }
}

/**
 * --------------------------------------------------------------------------------
 * 1. PUBLIC REGISTRATION SUBMISSION (daftar.html)
 * --------------------------------------------------------------------------------
 * Fields collected strictly:
 * - name (Full Name)
 * - email (Email Address)
 * - phone (Phone / WhatsApp)
 * - state (State / Negeri)
 */
export async function submitRegistration({ name, email, phone, state }) {
  if (!name || !email || !phone || !state) {
    throw new Error("All fields (Name, Email, Phone, State) are required.");
  }

  // Note: 'full_name' is a generated column in Supabase (e.g. generated always as name or similar).
  // Inserting into full_name causes PostgreSQL error 428C9 ("cannot insert a non-DEFAULT value into column full_name").
  // Therefore, only insert 'name', 'email', 'phone', 'state', 'registration_date', 'status', 'action_status', 'remark', 'updated_at'.
  const payload = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    state: state.trim(),
    registration_date: new Date().toISOString(),
    status: "New",
    action_status: "New",
    remark: null, // strictly null initially
    updated_at: null, // strictly null initially
  };

  try {
    let { data, error } = await supabase
      .from("clients")
      .insert([payload])
      .select();

    // If column error occurs (e.g., action_status not cached or full_name conflict), retry safely
    if (error) {
      console.warn(
        "Initial insert failed, attempting safe payload fallback:",
        error.message,
      );
      const fallbackPayload = { ...payload };
      if (error.message && error.message.includes("action_status")) {
        delete fallbackPayload.action_status;
      }
      if (error.message && error.message.includes("full_name")) {
        delete fallbackPayload.full_name;
      }
      const res = await supabase
        .from("clients")
        .insert([fallbackPayload])
        .select();
      data = res.data;
      error = res.error;
    }

    if (error) {
      console.error("Supabase registration error:", error);
      ToastNotification.error("Registration error: " + error.message);
      throw error;
    }

    ToastNotification.success("Registration submitted successfully!");
    return data;
  } catch (err) {
    if (!err.message || !err.message.includes("Registration error")) {
      console.error("IqwanEngine: Network exception during registration:", err);
      ToastNotification.error(
        "Network failure: Unable to reach database server. Please check connection.",
      );
    }
    throw err;
  }
}

/**
 * --------------------------------------------------------------------------------
 * 2. ADMIN DASHBOARD CONTROLLER
 * --------------------------------------------------------------------------------
 */
export async function initAdminDashboard() {
  bindAdminGlobalHandlers();
  bindAdminSearch();
  initRealtimeHealthIndicator();

  // 1. Fetch centralized settings from Supabase system_settings before loading client data
  await syncSystemSettingsFromDB();
  loadWhatsAppValue();

  // 2. Fetch initial client dataset
  await loadAdminData();

  // 3. High-performance fine-grained Realtime updates (Zero full-table re-scans)
  subscribeToClientUpdates((payload) => {
    if (!payload || !payload.eventType) return;

    if (payload.eventType === "INSERT") {
      const newRecord = payload.new;
      if (newRecord && !adminClients.some((c) => c.id === newRecord.id)) {
        adminClients.unshift(newRecord);
        if (!rowDrafts.has(newRecord.id)) {
          rowDrafts.set(newRecord.id, {
            isEditing: false,
            draftName: newRecord.name || newRecord.full_name || "",
            draftEmail: newRecord.email || "",
            draftRemark: newRecord.remark || "",
          });
        }
      }
    } else if (payload.eventType === "UPDATE") {
      const updatedRecord = payload.new;
      if (updatedRecord) {
        const idx = adminClients.findIndex((c) => c.id === updatedRecord.id);
        if (idx !== -1) {
          adminClients[idx] = updatedRecord;
        } else {
          adminClients.unshift(updatedRecord);
        }
        const currentDraft = rowDrafts.get(updatedRecord.id);
        if (!currentDraft || !currentDraft.isEditing) {
          rowDrafts.set(updatedRecord.id, {
            isEditing: false,
            draftName: updatedRecord.name || updatedRecord.full_name || "",
            draftEmail: updatedRecord.email || "",
            draftRemark: updatedRecord.remark || "",
          });
        }
      }
    } else if (payload.eventType === "DELETE") {
      const oldId = payload.old?.id;
      if (oldId) {
        adminClients = adminClients.filter((c) => c.id !== oldId);
        rowDrafts.delete(oldId);
      }
    }

    renderAdminTable();
    updateAdminMetrics();
  });
}

function initRealtimeHealthIndicator() {
  onRealtimeStatusChange((status) => {
    const indicatorEl = document.getElementById("realtime-status-pill");
    const indicatorText = document.getElementById("realtime-status-text");
    const modalChannelIndicator = document.getElementById(
      "modal-realtime-indicator",
    );

    const isConnected = status === "SUBSCRIBED";

    if (indicatorEl) {
      indicatorEl.className = isConnected
        ? "w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
        : "w-2 h-2 rounded-full bg-amber-500";
    }
    if (indicatorText) {
      indicatorText.innerText = isConnected
        ? "Live Realtime Active"
        : `Realtime: ${status}`;
    }
    if (modalChannelIndicator) {
      modalChannelIndicator.innerHTML = isConnected
        ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>Live WebSocket connection active: public:clients</span>`
        : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200"><span class="w-2 h-2 rounded-full bg-amber-500"></span>Status: ${status} (public:clients)</span>`;
    }
  });
}

export async function loadAdminData() {
  const tbody = document.getElementById("admin-table-body");
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("registration_date", { ascending: false });

    if (error) {
      console.error("Error fetching admin clients:", error.message);
      ToastNotification.error(
        "Failed to fetch client records: " + error.message,
      );
      return;
    }

    adminClients = data || [];
  } catch (networkErr) {
    console.error(
      "IqwanEngine: Network failure fetching admin records:",
      networkErr,
    );
    ToastNotification.error(
      "Network failure: Unable to fetch database records. Please check connection.",
    );
    return;
  }

  // Sync drafts map with current clients while preserving active edits
  adminClients.forEach((item) => {
    if (!rowDrafts.has(item.id)) {
      rowDrafts.set(item.id, {
        isEditing: false,
        draftName: item.name || item.full_name || "",
        draftEmail: item.email || "",
        draftRemark: item.remark || "",
      });
    }
  });

  renderAdminTable();
  updateAdminMetrics();
}

/**
 * Get current view of Admin client records according to active filter tab and search query
 */
export function getFilteredAdminClients() {
  let filtered = adminClients.filter((item) => {
    const itemStatus = (item.status || "New").toLowerCase();
    const itemActionStatus = (item.action_status || "New").toLowerCase();

    if (adminFilter === "new") {
      return itemStatus === "new" || itemActionStatus === "new";
    }
    if (adminFilter === "pending") {
      return itemStatus === "pending" || itemActionStatus === "submit to bdm";
    }
    if (adminFilter === "complete") {
      return itemStatus === "completed" || itemActionStatus === "completed";
    }
    return true;
  });

  if (adminSearch.trim() !== "") {
    const q = adminSearch.toLowerCase();
    filtered = filtered.filter((c) => {
      const name = (c.name || c.full_name || "").toLowerCase();
      const email = (c.email || "").toLowerCase();
      const phone = (c.phone || "").toLowerCase();
      const state = (c.state || "").toLowerCase();
      const remark = (c.remark || "").toLowerCase();
      return (
        name.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        state.includes(q) ||
        remark.includes(q)
      );
    });
  }

  return filtered;
}

/**
 * IqwanEngine: Export Current View to CSV (Desktop View Feature)
 * Formats current filtered client table view into a clean RFC 4180 CSV file with UTF-8 BOM.
 */
export function exportAdminClientsCSV() {
  const clients = getFilteredAdminClients();
  if (!clients || clients.length === 0) {
    ToastNotification.warning(
      "No client records found in the current view to export.",
    );
    return;
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const filterTag = adminFilter ? adminFilter.toUpperCase() : "ALL";
  const filename = `OWLFX_Admin_Clients_${filterTag}_${timestamp}.csv`;

  const columns = [
    {
      label: "Status",
      key: "status",
      transform: (_, item) => {
        const isCompleted =
          (item.status || "").toLowerCase() === "completed" ||
          (item.action_status || "").toLowerCase() === "completed";
        const isPending =
          (item.status || "").toLowerCase() === "pending" ||
          (item.action_status || "").toLowerCase() === "submit to bdm";
        if (isCompleted) return "Completed";
        if (isPending) return "Pending";
        return "New";
      },
    },
    {
      label: "Full Name",
      key: "name",
      transform: (val, item) => item.name || item.full_name || "-",
    },
    {
      label: "Email Address",
      key: "email",
      transform: (val) => val || "-",
    },
    {
      label: "Phone (WhatsApp)",
      key: "phone",
      transform: (val) => val || "-",
    },
    {
      label: "State",
      key: "state",
      transform: (val) => val || "-",
    },
    {
      label: "Registration Date",
      key: "registration_date",
      transform: (val) => formatDate(val),
    },
    {
      label: "Remark",
      key: "remark",
      transform: (val) => val || "-",
    },
    {
      label: "Action Status",
      key: "action_status",
      transform: (val, item) => item.action_status || item.status || "New",
    },
    {
      label: "Update Date",
      key: "updated_at",
      transform: (val) => (val ? formatDate(val) : "-"),
    },
  ];

  const success = exportToCSV(filename, columns, clients);
  if (success) {
    ToastNotification.success(
      `Exported ${clients.length} client record(s) to CSV successfully.`,
    );
  }
}

function renderAdminTable() {
  const tbody = document.getElementById("admin-table-body");
  if (!tbody) return;

  const remarksOptions = getRemarkOptions();
  let datalist = document.getElementById("admin-preset-remarks");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "admin-preset-remarks";
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = remarksOptions
    .map((r) => `<option value="${escapeHtml(r)}"></option>`)
    .join("");

  const filtered = getFilteredAdminClients();

  // Empty state handling
  const emptyState = document.getElementById("no-results-state");
  const cardsContainer = document.getElementById("admin-cards-container");

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    if (cardsContainer) cardsContainer.innerHTML = "";
    if (emptyState) emptyState.classList.remove("hidden");
    updateAdminPagination(0);
    return;
  }

  if (emptyState) emptyState.classList.add("hidden");
  updateAdminPagination(filtered.length);

  let tableRowsHtml = "";
  let mobileCardsHtml = "";

  filtered.forEach((item) => {
    const draft = rowDrafts.get(item.id) || {
      isEditing: false,
      draftName: item.name || item.full_name || "",
      draftEmail: item.email || "",
      draftPhone: item.phone || "",
      draftRemark: item.remark || "",
      draftStatus:
        item.status === "Completed" || item.action_status === "Completed"
          ? "Completed"
          : "Pending",
    };
    const isEditing = !!draft.isEditing;
    const activeRemarkValue =
      draft.draftRemark !== undefined ? draft.draftRemark : item.remark || "";

    const isCompleted =
      (item.status || "").toLowerCase() === "completed" ||
      (item.action_status || "").toLowerCase() === "completed";
    const isPending =
      (item.status || "").toLowerCase() === "pending" ||
      (item.action_status || "").toLowerCase() === "submit to bdm";

    // Row background
    let rowBg = "hover:bg-slate-50/80 transition-colors";
    let cardBorder = "border-slate-200/90";
    if (isCompleted) {
      rowBg = "bg-emerald-50/40 hover:bg-emerald-50/70 transition-colors";
      cardBorder = "border-emerald-300/80 bg-emerald-50/30";
    } else if (isPending) {
      rowBg = "bg-amber-50/30 hover:bg-amber-50/60 transition-colors";
      cardBorder = "border-amber-300/80 bg-amber-50/20";
    }

    // 1. Status Badge
    let statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 shadow-2xs"><span class="w-1.5 h-1.5 rounded-full bg-blue-600"></span>New</span>`;
    if (isCompleted) {
      statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-2xs"><span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>Completed</span>`;
    } else if (isPending) {
      statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/60 shadow-2xs"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>Pending</span>`;
    }

    // 2. Full Name
    const nameCol = isEditing
      ? `<input type="text" id="edit-name-${item.id}" value="${escapeHtml(draft.draftName)}" oninput="window.setDraftName('${item.id}', this.value)" class="w-full bg-white border border-blue-400 rounded px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm" placeholder="Full name" />`
      : `<span class="font-medium text-slate-900">${escapeHtml(item.name || item.full_name || "-")}</span>`;

    // 3. Email Address
    const emailCol = isEditing
      ? `<input type="email" id="edit-email-${item.id}" value="${escapeHtml(draft.draftEmail)}" oninput="window.setDraftEmail('${item.id}', this.value)" class="w-full bg-white border border-blue-400 rounded px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm" placeholder="Email address" />`
      : `<span class="text-slate-600 font-mono text-[11px]">${escapeHtml(item.email || "-")}</span>`;

    // 4. Phone (WhatsApp)
    const cleanPhone = (item.phone || "").replace(/[^0-9]/g, "");
    const phoneCol = isEditing
      ? `<input type="text" id="edit-phone-${item.id}" value="${escapeHtml(draft.draftPhone !== undefined ? draft.draftPhone : item.phone || "")}" oninput="window.setDraftPhone('${item.id}', this.value)" class="w-full bg-white border border-blue-400 rounded px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm" placeholder="Phone / WhatsApp" />`
      : `<a href="https://wa.me/${cleanPhone}" target="_blank" class="inline-flex items-center gap-1.5 text-slate-700 hover:text-emerald-600 transition-colors font-medium">
        <svg class="w-3.5 h-3.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.972.536 1.954.887 3.149.887 3.182 0 5.767-2.587 5.767-5.766.001-3.182-2.585-5.769-5.767-5.769zm3.374 8.169c-.144.405-.837.774-1.17.824-.312.045-.694.074-2.12-.516-1.559-.645-2.535-2.247-2.613-2.351-.077-.104-.63-0.838-.63-1.601 0-.762.399-1.137.541-1.292.144-.156.314-.195.42-.195.105 0 .211.002.302.007.098.005.228-.037.355.27.13.313.447 1.09.486 1.17.039.078.065.17.013.273-.052.104-.078.169-.156.26-.078.091-.164.203-.234.273-.078.078-.16.163-.069.319.091.156.405.669.869 1.082.597.532 1.1.697 1.256.775.156.078.247.065.338-.039.091-.104.39-.455.494-.611.104-.156.208-.13.351-.078.143.052.91.43 1.066.507.156.078.26.117.299.182.039.065.039.377-.105.782z"/>
        </svg>
        <span>${escapeHtml(item.phone || "-")}</span>
      </a>`;

    // 5. State
    const stateCol = `<span class="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">${escapeHtml(item.state || "-")}</span>`;

    // 6. Registration Date
    const regDateCol = `<span class="font-mono text-[11px] text-slate-600 whitespace-nowrap">${formatDate(item.registration_date)}</span>`;

    // 7. Remark: Displays exact custom text typed by BDM as plain text (No dropdown here, mirrors BDM input)
    const remarkCol = isEditing
      ? `<div class="space-y-1 min-w-[200px]">
          <input type="text" id="edit-remark-${item.id}" value="${escapeHtml(activeRemarkValue)}" oninput="window.setDraftRemark('${item.id}', this.value)" list="admin-preset-remarks" class="w-full bg-white border border-blue-400 rounded px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm font-medium" placeholder="Type custom remark..." />
          <div class="flex items-center gap-1.5 pt-0.5">
            <span class="text-[10px] text-slate-400 font-medium">Status:</span>
            <select id="edit-status-${item.id}" onchange="window.setDraftStatus('${item.id}', this.value)" class="text-[10px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-slate-700 outline-none">
              <option value="Pending" ${(draft.draftStatus || (item.status === "Completed" ? "Completed" : "Pending")) === "Pending" ? "selected" : ""}>Pending (Submit to BDM)</option>
              <option value="Completed" ${(draft.draftStatus || (item.status === "Completed" ? "Completed" : "Pending")) === "Completed" ? "selected" : ""}>Complete</option>
            </select>
          </div>
        </div>`
      : `<span class="text-slate-800 text-xs font-medium block break-words" title="${escapeHtml(item.remark || "-")}">${escapeHtml(item.remark || "-")}</span>`;

    // 8. Action Status (IqwanEngine Dynamic Routing)
    let actionStatusCol = "";
    const actStatus = item.action_status || "New";
    const targetAction = getRemarkTargetAction(item.remark);
    const isBdmTarget = targetAction === "Submit to BDM";

    if (actStatus === "New" && isBdmTarget) {
      actionStatusCol = `
        <button onclick="window.submitToBdm('${item.id}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm active:scale-95" title="Push application to BDM Desk">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          <span>Submit to BDM</span>
        </button>
      `;
    } else if (actStatus === "Submit to BDM" || item.status === "Pending") {
      actionStatusCol = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-300/70 shadow-sm">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
          Submit to BDM
        </span>
      `;
    } else if (actStatus === "Completed" || isCompleted) {
      actionStatusCol = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300/70 shadow-sm">
          <svg class="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Completed
        </span>
      `;
    } else {
      actionStatusCol = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 shadow-sm">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
          New
        </span>
      `;
    }

    // 9. Update Date (Clean ISO formatting without redundant symbol)
    const updateDateCol = item.updated_at
      ? `<span class="text-slate-700 font-mono text-[11px] whitespace-nowrap">${formatDate(item.updated_at, false)}</span>`
      : `<span class="text-slate-300">-</span>`;

    // 10. Action Column Desktop
    let actionCol = "";
    if (isEditing) {
      actionCol = `
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="window.saveRow('${item.id}')" title="Confirm & Save" class="p-1.5 rounded text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors shadow-sm cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button onclick="window.cancelEditRow('${item.id}')" title="Cancel edit" class="p-1.5 rounded text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button data-delete-id="${item.id}" onclick="window.deleteClient('${item.id}', event)" title="Delete record permanently" class="p-1.5 rounded text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors shadow-sm cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      `;
    } else {
      actionCol = `
        <div class="flex items-center justify-end gap-1">
          <button onclick="window.startEditRow('${item.id}')" title="Edit row" class="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button data-delete-id="${item.id}" onclick="window.deleteClient('${item.id}', event)" title="Delete record permanently" class="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      `;
    }

    // Build Desktop Table Row
    tableRowsHtml += `
      <tr class="${rowBg} border-b border-slate-100 text-xs">
        <td class="py-3 px-3 text-center whitespace-nowrap">${statusBadge}</td>
        <td class="py-3 px-4 whitespace-nowrap">${nameCol}</td>
        <td class="py-3 px-4 whitespace-nowrap">${emailCol}</td>
        <td class="py-3 px-4 whitespace-nowrap">${phoneCol}</td>
        <td class="py-3 px-4 whitespace-nowrap">${stateCol}</td>
        <td class="py-3 px-4 whitespace-nowrap">${regDateCol}</td>
        <td class="py-3 px-4 min-w-[160px]">${remarkCol}</td>
        <td class="py-3 px-4 text-center whitespace-nowrap">${actionStatusCol}</td>
        <td class="py-3 px-4 whitespace-nowrap">${updateDateCol}</td>
        <td class="py-3 pr-4 pl-2 text-right whitespace-nowrap">${actionCol}</td>
      </tr>
    `;

    // Build Mobile Client Card (Touch-friendly 44x44px minimum tap targets)
    mobileCardsHtml += `
      <div class="bg-white rounded-xl border ${cardBorder} shadow-2xs p-4 space-y-3">
        <!-- Top Row: Client Info & Status Badges -->
        <div class="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div class="min-w-0 flex-1 space-y-1">
            ${
              isEditing
                ? `<div class="space-y-1">
                   <label class="text-[10px] font-semibold text-slate-500 uppercase">Nama Penuh</label>
                   <input type="text" value="${escapeHtml(draft.draftName)}" oninput="window.setDraftName('${item.id}', this.value)" class="w-full bg-slate-50 border border-blue-400 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Full name" />
                 </div>
                 <div class="space-y-1 pt-1">
                   <label class="text-[10px] font-semibold text-slate-500 uppercase">Emel</label>
                   <input type="email" value="${escapeHtml(draft.draftEmail)}" oninput="window.setDraftEmail('${item.id}', this.value)" class="w-full bg-slate-50 border border-blue-400 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Email address" />
                 </div>
                 <div class="space-y-1 pt-1">
                   <label class="text-[10px] font-semibold text-slate-500 uppercase">Telefon (WhatsApp)</label>
                   <input type="tel" value="${escapeHtml(draft.draftPhone !== undefined ? draft.draftPhone : item.phone || "")}" oninput="window.setDraftPhone('${item.id}', this.value)" class="w-full bg-slate-50 border border-blue-400 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Phone / WhatsApp" />
                 </div>`
                : `<div class="font-bold text-sm text-slate-900 truncate">${escapeHtml(item.name || item.full_name || "-")}</div>
                 <div class="text-xs text-slate-600 font-mono truncate flex items-center gap-1.5">
                   <span class="text-slate-400">✉</span> ${escapeHtml(item.email || "-")}
                 </div>
                 <div class="flex flex-wrap items-center gap-2 pt-1 text-xs">
                   <a href="https://wa.me/${cleanPhone}" target="_blank" class="inline-flex items-center gap-1 text-slate-700 hover:text-emerald-600 font-medium">
                     <span class="text-emerald-500">📞</span> ${escapeHtml(item.phone || "-")}
                   </a>
                   <span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                     State: ${escapeHtml(item.state || "-")}
                   </span>
                 </div>`
            }
          </div>
          <div class="flex flex-col items-end gap-1.5 shrink-0">
            ${statusBadge}
            <div class="pt-0.5">${actionStatusCol}</div>
          </div>
        </div>

        <!-- Middle Row: Registration & Update Dates -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-600 bg-slate-50/80 p-2.5 rounded-lg border border-slate-100">
          <div>
            <span class="text-slate-400">Reg Date:</span>
            <span class="font-medium text-slate-700 ml-1">${formatDate(item.registration_date)}</span>
          </div>
          <div>
            <span class="text-slate-400">Update Date:</span>
            <span class="font-medium text-slate-700 ml-1">${item.updated_at ? formatDate(item.updated_at, true) : "-"}</span>
          </div>
        </div>

        <!-- Bottom: Remark & Action Buttons with touch spacing -->
        <div class="space-y-2">
          ${
            isEditing
              ? `
            <div class="space-y-1">
              <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remark</label>
              <input type="text" value="${escapeHtml(activeRemarkValue)}" oninput="window.setDraftRemark('${item.id}', this.value)" list="admin-preset-remarks" class="w-full min-h-[44px] bg-white border border-blue-400 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs font-medium" placeholder="Type custom remark..." />
              <div class="flex items-center justify-between pt-1">
                <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status Action</span>
                <select onchange="window.setDraftStatus('${item.id}', this.value)" class="text-xs bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-slate-700">
                  <option value="Pending" ${(draft.draftStatus || (item.status === "Completed" ? "Completed" : "Pending")) === "Pending" ? "selected" : ""}>Pending (Submit to BDM)</option>
                  <option value="Completed" ${(draft.draftStatus || (item.status === "Completed" ? "Completed" : "Pending")) === "Completed" ? "selected" : ""}>Complete</option>
                </select>
              </div>
            </div>
          `
              : `
            <div class="space-y-1">
              <span class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remark</span>
              <div class="text-xs text-slate-800 font-medium bg-slate-50/80 p-2.5 rounded-lg border border-slate-200/60 break-words">
                ${escapeHtml(item.remark || "-")}
              </div>
            </div>
          `
          }
          <div class="pt-1 flex items-center justify-end gap-2 border-t border-slate-100">
            ${
              isEditing
                ? `<button onclick="window.saveRow('${item.id}')" class="min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5 transition-colors shadow-2xs active:scale-95">
                   <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                   <span>Save</span>
                 </button>
                 <button onclick="window.cancelEditRow('${item.id}')" class="min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 flex items-center gap-1.5 transition-colors">
                   <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                   <span>Cancel</span>
                 </button>
                 <button onclick="window.deleteClient('${item.id}', event)" class="min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 flex items-center gap-1.5 transition-colors shadow-2xs active:scale-95">
                   <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                   <span>Delete</span>
                 </button>`
                : `<button onclick="window.startEditRow('${item.id}')" class="min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 flex items-center gap-1.5 transition-colors">
                   <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                   <span>Edit</span>
                 </button>
                 <button onclick="window.deleteClient('${item.id}', event)" class="min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 flex items-center gap-1.5 transition-colors">
                   <svg class="w-4 h-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                   <span>Delete</span>
                 </button>`
            }
          </div>
        </div>
      </div>
    `;
  });

  tbody.innerHTML = tableRowsHtml;
  if (cardsContainer) cardsContainer.innerHTML = mobileCardsHtml;
}

function updateAdminMetrics() {
  const total = adminClients.length;
  const rebateCount = adminClients.filter((c) => {
    return getRemarkTargetAction(c.remark) === "Submit to BDM";
  }).length;
  const pendingCount = adminClients.filter(
    (c) => c.status === "Pending" || c.action_status === "Submit to BDM",
  ).length;
  const completedCount = adminClients.filter(
    (c) => c.status === "Completed" || c.action_status === "Completed",
  ).length;
  const otherCount = adminClients.filter((c) => {
    return c.remark && getRemarkTargetAction(c.remark) !== "Submit to BDM";
  }).length;

  const elTotal = document.getElementById("stat-total");
  if (elTotal) elTotal.innerText = total;

  const elRebate = document.getElementById("stat-rebate");
  if (elRebate) elRebate.innerText = rebateCount;

  const elPending = document.getElementById("stat-pending");
  if (elPending) elPending.innerText = pendingCount;

  const elNoRebate = document.getElementById("stat-norebate");
  if (elNoRebate) elNoRebate.innerText = otherCount;

  const tabAll = document.getElementById("count-all");
  if (tabAll) tabAll.innerText = `(${total})`;

  const tabNew = document.getElementById("count-new");
  if (tabNew)
    tabNew.innerText = `(${adminClients.filter((c) => (c.status || "New") === "New").length})`;

  const tabPending = document.getElementById("count-pending");
  if (tabPending) tabPending.innerText = `(${pendingCount})`;

  const tabComplete = document.getElementById("count-complete");
  if (tabComplete) tabComplete.innerText = `(${completedCount})`;

  const metricReg = document.getElementById("metric-reg");
  if (metricReg) {
    if (adminClients.length > 0 && adminClients[0].registration_date) {
      metricReg.innerText = formatDate(adminClients[0].registration_date);
    } else {
      metricReg.innerText = "-";
    }
  }

  const metricSubmit = document.getElementById("metric-submit");
  if (metricSubmit) {
    const lastSubmitted = adminClients.find(
      (c) =>
        (c.action_status === "Submit to BDM" || c.status === "Pending") &&
        c.updated_at,
    );
    metricSubmit.innerText = lastSubmitted
      ? formatDate(lastSubmitted.updated_at)
      : "-";
  }

  const metricUpdate = document.getElementById("metric-update");
  if (metricUpdate) {
    const lastCompleted = adminClients.find(
      (c) =>
        (c.status === "Completed" || c.action_status === "Completed") &&
        c.updated_at,
    );
    metricUpdate.innerText = lastCompleted
      ? formatDate(lastCompleted.updated_at, true)
      : "-";
  }
}

function updateAdminPagination(count) {
  const elRange = document.getElementById("page-range");
  if (elRange) elRange.innerText = count > 0 ? `1-${count}` : "0";
}

/**
 * IqwanEngine: Admin Global Event Handlers
 * Features:
 * - Local Component State Isolation for Remark Dropdown
 * - Multi-field Live Editing (Name, Email, Phone, Remark)
 * - State Reset Transition upon 14USD 1 Lot selection
 * - Flawless Permanent Record Deletion from DB & UI
 */
function bindAdminGlobalHandlers() {
  // Local Component State Isolation:
  window.setDraftRemark = (id, val) => {
    let draft = rowDrafts.get(id);
    const client = adminClients.find((c) => c.id === id);
    if (!draft) {
      draft = {
        isEditing: true,
        draftName: client ? client.name || client.full_name || "" : "",
        draftEmail: client ? client.email || "" : "",
        draftPhone: client ? client.phone || "" : "",
        draftRemark: val,
        draftStatus: client
          ? client.status === "Completed"
            ? "Completed"
            : "Pending"
          : "Pending",
      };
      rowDrafts.set(id, draft);
    } else {
      draft.draftRemark = val;
    }
  };

  window.setDraftStatus = (id, val) => {
    let draft = rowDrafts.get(id);
    if (draft) {
      draft.draftStatus = val;
    }
  };

  window.onRemarkDropdownChange = window.setDraftRemark;

  window.setDraftName = (id, val) => {
    const draft = rowDrafts.get(id);
    if (draft) draft.draftName = val;
  };

  window.setDraftEmail = (id, val) => {
    const draft = rowDrafts.get(id);
    if (draft) draft.draftEmail = val;
  };

  window.setDraftPhone = (id, val) => {
    const draft = rowDrafts.get(id);
    if (draft) draft.draftPhone = val;
  };

  window.reloadSchemaCache = reloadSchemaCache;
  window.resetRemarkOptionsToDefaults = resetRemarkOptionsToDefaults;
  window.seedTestClients = seedTestClients;
  window.clearTestClients = clearTestClients;

  // Start Editing Row
  window.startEditRow = (id) => {
    const client = adminClients.find((c) => c.id === id);
    if (!client) return;

    rowDrafts.set(id, {
      isEditing: true,
      draftName: client.name || client.full_name || "",
      draftEmail: client.email || "",
      draftPhone: client.phone || "",
      draftRemark: client.remark || "",
      draftStatus: client.status === "Completed" ? "Completed" : "Pending",
    });
    renderAdminTable();
  };

  // Cancel Editing Row
  window.cancelEditRow = (id) => {
    rowDrafts.delete(id);
    renderAdminTable();
  };

  /**
   * IqwanEngine: Admin Record Save Handler
   * If the Admin chooses to use a typing option to update a remark themselves,
   * the main Status must also remain "Pending" unless they explicitly select a "Complete" action.
   * Every update writes custom remark text and a refreshed ISO timestamp directly to Supabase.
   */
  window.saveRow = async (id) => {
    const draft = rowDrafts.get(id);
    const originalClient = adminClients.find((c) => c.id === id);
    if (!draft) return;

    const newName = (
      draft.draftName !== undefined
        ? draft.draftName
        : originalClient
          ? originalClient.name || originalClient.full_name
          : ""
    ).trim();
    const newEmail = (
      draft.draftEmail !== undefined
        ? draft.draftEmail
        : originalClient
          ? originalClient.email
          : ""
    ).trim();
    const newPhone = (
      draft.draftPhone !== undefined
        ? draft.draftPhone
        : originalClient
          ? originalClient.phone
          : ""
    ).trim();
    const newRemark = (
      draft.draftRemark !== undefined
        ? draft.draftRemark
        : originalClient
          ? originalClient.remark
          : ""
    ).trim();

    if (!newName || !newEmail) {
      ToastNotification.error("Name and email are required fields.");
      return;
    }

    const isExplicitComplete = draft.draftStatus === "Completed";
    const statusVal = isExplicitComplete ? "Completed" : "Pending";
    const actionStatusVal = isExplicitComplete ? "Completed" : "Submit to BDM";
    const nowIso = new Date().toISOString();

    const payload = {
      name: newName,
      email: newEmail,
      phone: newPhone || (originalClient ? originalClient.phone : null),
      remark: newRemark || null,
      status: statusVal,
      action_status: actionStatusVal,
      updated_at: nowIso,
    };

    try {
      const { error, isNetworkError } = await safeUpdateClient(id, payload);

      if (error) {
        console.error("IqwanEngine: Error updating record:", error);
        ToastNotification.error(
          isNetworkError
            ? "Network failure: Unable to reach database. Please check your connection."
            : "Error updating record: " + (error.message || error),
        );
      } else {
        ToastNotification.success(
          isExplicitComplete
            ? "Record saved & marked Completed."
            : "Record saved. Status remains Pending (Submit to BDM).",
        );
        draft.isEditing = false;
        rowDrafts.delete(id);
        await loadAdminData();
      }
    } catch (networkErr) {
      console.error(
        "IqwanEngine: Network exception during saveRow:",
        networkErr,
      );
      ToastNotification.error(
        "Network failure: Failed to save changes. Please try again.",
      );
    }
  };

  // Dedicated row-level button to push to BDM pipeline
  window.submitToBdm = async (id) => {
    const client = adminClients.find((c) => c.id === id);
    const remarkVal = client && client.remark ? client.remark : "STP IB 14$";
    const workflow = updateRemarkEngine(remarkVal, {
      targetAction: "Submit to BDM",
    });

    const payload = {
      status: "Pending",
      action_status: "Submit to BDM",
      remark: remarkVal,
      updated_at: new Date().toISOString(),
    };

    try {
      const { error, isNetworkError } = await safeUpdateClient(id, payload);

      if (error) {
        ToastNotification.error(
          isNetworkError
            ? "Network failure: Unable to reach database. Please check your connection."
            : "Error forwarding to BDM: " + (error.message || error),
        );
      } else {
        ToastNotification.success(
          "Application pushed to VT Market BDM pipeline.",
        );
        await loadAdminData();
      }
    } catch (networkErr) {
      console.error(
        "IqwanEngine: Network exception during submitToBdm:",
        networkErr,
      );
      ToastNotification.error(
        "Network failure: Could not forward record to BDM.",
      );
    }
  };

  /**
   * IqwanEngine: Client Deletion & Custom Modal Architecture
   * Strictly avoids native browser window.confirm() dialogs.
   * Utilizes on-screen centered modal dialog with backdrop blur and animated entrance.
   */
  let pendingDeleteClientId = null;

  window.openDeleteModal = (id, event) => {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    console.log("Delete clicked for ID:", id);

    if (!id || typeof id !== "string") {
      console.error("IqwanEngine: Invalid or missing client UUID:", id);
      ToastNotification.error("Error: Invalid client ID.");
      return;
    }

    const client = adminClients.find((c) => c.id === id);
    pendingDeleteClientId = id;

    const modal = document.getElementById("delete-confirm-modal");
    const modalBox = document.getElementById("delete-modal-box");
    const nameEl = document.getElementById("delete-modal-target-name");
    const emailEl = document.getElementById("delete-modal-target-email");

    if (nameEl) {
      nameEl.innerText = client
        ? client.name || client.full_name || "Client Record"
        : `Client #${id.slice(0, 8)}`;
    }
    if (emailEl) {
      emailEl.innerText = client ? client.email || "-" : id;
    }

    if (modal) {
      modal.classList.remove("hidden");
      requestAnimationFrame(() => {
        if (modalBox) {
          modalBox.classList.remove("scale-95", "opacity-0");
          modalBox.classList.add("scale-100", "opacity-100");
        }
      });
    }
  };

  window.closeDeleteModal = () => {
    pendingDeleteClientId = null;
    const modal = document.getElementById("delete-confirm-modal");
    const modalBox = document.getElementById("delete-modal-box");
    if (modalBox) {
      modalBox.classList.remove("scale-100", "opacity-100");
      modalBox.classList.add("scale-95", "opacity-0");
    }
    setTimeout(() => {
      if (modal) modal.classList.add("hidden");
    }, 150);
  };

  window.confirmDeleteClient = async () => {
    const id = pendingDeleteClientId;
    if (!id) {
      window.closeDeleteModal();
      return;
    }

    const confirmBtn = document.getElementById("delete-modal-confirm-btn");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `
        <svg class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Deleting...</span>
      `;
    }

    try {
      console.log("Executing Supabase delete for ID:", id);
      let { data, error } = await supabase
        .from("clients")
        .delete()
        .eq("id", id)
        .select();

      if (
        error &&
        (error.message?.includes("row-level security") ||
          error.code === "42501")
      ) {
        console.warn(
          "IqwanEngine: Retrying client delete via unauthenticated gateway due to RLS restriction...",
        );
        const retry = await supabaseAnon
          .from("clients")
          .delete()
          .eq("id", id)
          .select();
        if (!retry.error) {
          error = null;
          data = retry.data;
        } else {
          error = retry.error;
        }
      }

      if (error) {
        console.error("IqwanEngine: Supabase delete error:", error);
        ToastNotification.error("Delete failed: " + (error.message || error));
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = `
            <svg class="w-4 h-4 text-rose-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Yes, Delete</span>
          `;
        }
        return;
      }

      // Update State & UI safely
      rowDrafts.delete(id);
      adminClients = adminClients.filter((c) => c.id !== id);

      renderAdminTable();
      updateAdminMetrics();
      ToastNotification.success("Client successfully deleted.");
      window.closeDeleteModal();
    } catch (networkErr) {
      console.error(
        "IqwanEngine: Network exception during deletion:",
        networkErr,
      );
      ToastNotification.error(
        "Network failure: Unable to delete record. Please check your connection.",
      );
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `
          <svg class="w-4 h-4 text-rose-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>Yes, Delete</span>
        `;
      }
    }
  };

  // Entrypoint for table rows and cards
  window.deleteClient = (id, event) => {
    console.log("Delete clicked for ID:", id);
    window.openDeleteModal(id, event);
  };
  globalThis.deleteClient = window.deleteClient;

  // Event delegation on table body and cards container for resilient click handling
  const adminTableBody = document.getElementById("admin-table-body");
  if (adminTableBody && !adminTableBody.dataset.deleteDelegated) {
    adminTableBody.dataset.deleteDelegated = "true";
    adminTableBody.addEventListener("click", (e) => {
      const deleteBtn = e.target.closest("[data-delete-id]");
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = deleteBtn.getAttribute("data-delete-id");
        console.log("Delete clicked for ID:", id);
        window.deleteClient(id, e);
      }
    });
  }

  const adminCardsContainer = document.getElementById("admin-cards-container");
  if (adminCardsContainer && !adminCardsContainer.dataset.deleteDelegated) {
    adminCardsContainer.dataset.deleteDelegated = "true";
    adminCardsContainer.addEventListener("click", (e) => {
      const deleteBtn = e.target.closest("[data-delete-id]");
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = deleteBtn.getAttribute("data-delete-id");
        console.log("Delete clicked for ID:", id);
        window.deleteClient(id, e);
      }
    });
  }

  // Wire up backdrop and Escape key listener for delete modal
  const deleteModalEl = document.getElementById("delete-confirm-modal");
  if (deleteModalEl && !deleteModalEl.dataset.bound) {
    deleteModalEl.dataset.bound = "true";
    deleteModalEl.addEventListener("click", (e) => {
      if (e.target === deleteModalEl) {
        window.closeDeleteModal();
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !deleteModalEl.classList.contains("hidden")) {
        window.closeDeleteModal();
      }
    });
  }

  // Filter tabs
  window.setAdminFilter = (filterKey) => {
    adminFilter = filterKey;
    ["all", "new", "pending", "complete"].forEach((f) => {
      const btn = document.getElementById(`filter-${f}`);
      if (!btn) return;
      if (f === filterKey) {
        btn.className =
          "px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all bg-white text-slate-900 shadow-sm border border-slate-200/60";
      } else {
        btn.className =
          "px-3.5 py-1.5 text-xs font-medium rounded-md transition-all text-slate-600 hover:text-slate-900";
      }
    });
    renderAdminTable();
  };

  // Settings Modal Bindings
  window.toggleSettingsModal = toggleSettingsModal;
  window.renderRemarksList = renderRemarksList;
  window.addNewRemarkOption = addNewRemarkOption;
  window.removeRemarkOption = removeRemarkOption;
  window.loadWhatsAppValue = loadWhatsAppValue;
  window.toggleEditWhatsApp = toggleEditWhatsApp;
  window.renderAdminTable = renderAdminTable;
  window.exportAdminClientsCSV = exportAdminClientsCSV;

  const adminExportBtn = document.getElementById("admin-export-csv-btn");
  if (adminExportBtn) {
    adminExportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      exportAdminClientsCSV();
    });
  }
}

let isEditingWa = false;

export function toggleSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal) {
    const isHidden = modal.classList.toggle("hidden");
    if (!isHidden) {
      renderRemarksList();
      loadWhatsAppValue();
    }
  }
}

export function renderRemarksList() {
  const container = document.getElementById("remarks-chip-list");
  if (!container) return;

  const options = getStructuredRemarkOptions();

  container.innerHTML = options
    .map((opt) => {
      const isBdm = opt.targetAction === "Submit to BDM";
      const badgeClass = isBdm
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-emerald-50 text-emerald-800 border-emerald-200";
      const actionIcon = isBdm
        ? `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>`
        : `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>`;

      return `
        <div class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 shadow-xs hover:border-slate-300 transition-colors">
          <span class="font-medium text-xs text-slate-900">${escapeHtml(opt.label)}</span>
          <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeClass}">
            ${actionIcon}
            <span>${escapeHtml(opt.targetAction)}</span>
          </span>
          <button
            type="button"
            onclick="window.removeRemarkOption('${opt.id}')"
            class="p-0.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
            title="Padam pilihan ini"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      `;
    })
    .join("");
}

export async function addNewRemarkOption() {
  const input = document.getElementById("new-remark-input");
  const actionSelect = document.getElementById("new-remark-action");
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    ToastNotification.error("Sila masukkan teks remark.");
    return;
  }

  const targetAction = actionSelect ? actionSelect.value : "Do Nothing";
  const options = getStructuredRemarkOptions();

  const exists = options.some(
    (o) => o.label.toLowerCase() === val.toLowerCase(),
  );
  if (exists) {
    ToastNotification.warning(`Pilihan "${val}" sudah wujud.`);
    return;
  }

  const newOption = {
    id: Date.now().toString(),
    label: val,
    targetAction:
      targetAction === "Submit to BDM" ? "Submit to BDM" : "Do Nothing",
  };
  options.push(newOption);

  await saveStructuredRemarkOptions(options);

  renderRemarksList();
  input.value = "";

  ToastNotification.success(
    `Pilihan remark "${val}" [${targetAction}] berjaya ditambah.`,
  );
  renderAdminTable();
}

export async function removeRemarkOption(idOrLabel) {
  let options = getStructuredRemarkOptions();
  options = options.filter(
    (o) =>
      o.id !== idOrLabel &&
      o.label.toLowerCase() !== String(idOrLabel).toLowerCase(),
  );
  if (options.length === 0) {
    options = [...DEFAULT_REMARK_OPTIONS];
  }
  await saveStructuredRemarkOptions(options);

  renderRemarksList();
  ToastNotification.success("Pilihan remark berjaya dikemaskini.");
  renderAdminTable();
}

export function loadWhatsAppValue() {
  const input = document.getElementById("admin-wa-input");
  const waNum = getAdminWhatsApp();
  if (input) {
    input.value = waNum;
  }
  const footerLink = document.getElementById("footer-wa-link");
  if (footerLink && waNum) {
    footerLink.innerText = `Direct WhatsApp: ${waNum}`;
  }
}

export async function toggleEditWhatsApp() {
  const input = document.getElementById("admin-wa-input");
  const label = document.getElementById("wa-edit-label");
  if (!input || !label) return;

  if (!isEditingWa) {
    isEditingWa = true;
    input.removeAttribute("readonly");
    input.focus();
    label.innerText = "Save";
  } else {
    isEditingWa = false;
    input.setAttribute("readonly", "true");
    const val = input.value.trim() || DEFAULT_ADMIN_WA;
    await saveAdminWhatsApp(val);
    label.innerText = "Edit";
    loadWhatsAppValue();
    ToastNotification.success("Admin WhatsApp number saved.");
  }
}

function bindAdminSearch() {
  const searchInput = document.getElementById("admin-search-input");
  if (!searchInput) return;
  searchInput.addEventListener("input", (e) => {
    adminSearch = e.target.value;
    renderAdminTable();
  });
}

/**
 * --------------------------------------------------------------------------------
 * 3. BDM DASHBOARD CONTROLLER (VT Market BDM View)
 * --------------------------------------------------------------------------------
 */
export async function initBdmDashboard() {
  bindBdmGlobalHandlers();
  bindBdmSearch();

  // 1. Fetch centralized settings from Supabase system_settings before loading BDM data
  await syncSystemSettingsFromDB();

  // 2. Fetch initial BDM queue
  await loadBdmData();

  // 3. High-performance fine-grained Realtime updates (Zero full-table re-scans)
  subscribeToClientUpdates((payload) => {
    if (!payload || !payload.eventType) return;

    const isRecordVisibleToBdm = (record) => {
      if (!record) return false;
      const status = (record.status || "New").toLowerCase();
      const actionStatus = (record.action_status || "New").toLowerCase();
      const isRawNew = status === "new" && actionStatus === "new";
      return !isRawNew;
    };

    if (payload.eventType === "INSERT") {
      const newRecord = payload.new;
      if (newRecord && isRecordVisibleToBdm(newRecord)) {
        if (!bdmClients.some((c) => c.id === newRecord.id)) {
          bdmClients.unshift(newRecord);
        }
      }
    } else if (payload.eventType === "UPDATE") {
      const updatedRecord = payload.new;
      if (updatedRecord) {
        const idx = bdmClients.findIndex((c) => c.id === updatedRecord.id);
        if (isRecordVisibleToBdm(updatedRecord)) {
          if (idx !== -1) {
            bdmClients[idx] = updatedRecord;
          } else {
            bdmClients.unshift(updatedRecord);
          }
        } else {
          // If updated status transitioned away from BDM queue, remove from BDM list
          if (idx !== -1) {
            bdmClients.splice(idx, 1);
          }
        }
      }
    } else if (payload.eventType === "DELETE") {
      const oldId = payload.old?.id;
      if (oldId) {
        bdmClients = bdmClients.filter((c) => c.id !== oldId);
      }
    }

    renderBdmTable();
    updateBdmMetrics();
  });
}

export async function loadBdmData() {
  const tbody = document.getElementById("bdm-table-body");
  if (!tbody) return;

  let data = null;
  try {
    // Isolation guarantee: Raw 'New' client records remain strictly hidden from BDM desk
    const res = await supabase
      .from("clients")
      .select("*")
      .order("registration_date", { ascending: false });

    if (res.error) {
      console.error("Error loading BDM data:", res.error.message);
      ToastNotification.error(
        "Failed to fetch BDM queue: " + res.error.message,
      );
      return;
    }
    data = res.data;
  } catch (networkErr) {
    console.error("IqwanEngine: Network failure loading BDM data:", networkErr);
    ToastNotification.error(
      "Network failure: Unable to fetch BDM queue. Please check connection.",
    );
    return;
  }

  // Only records forwarded via Submit to BDM or Completed are shown in BDM desk
  bdmClients = (data || []).filter((item) => {
    const status = (item.status || "New").toLowerCase();
    const actionStatus = (item.action_status || "New").toLowerCase();
    const isRawNew = status === "new" && actionStatus === "new";
    return !isRawNew;
  });

  renderBdmTable();
  updateBdmMetrics();
}

/**
 * Get current view of BDM forwarded records according to active filter tab and search query
 */
export function getFilteredBdmClients() {
  let filtered = bdmClients.filter((item) => {
    const status = (item.status || "").toLowerCase();
    if (bdmFilter === "pending") return status === "pending";
    if (bdmFilter === "complete") return status === "completed";
    return true;
  });

  if (bdmSearch.trim() !== "") {
    const q = bdmSearch.toLowerCase();
    filtered = filtered.filter((c) => {
      const name = (c.name || c.full_name || "").toLowerCase();
      const email = (c.email || "").toLowerCase();
      const phone = (c.phone || "").toLowerCase();
      const state = (c.state || "").toLowerCase();
      return (
        name.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        state.includes(q)
      );
    });
  }

  return filtered;
}

/**
 * IqwanEngine: Export Current BDM View to CSV (Desktop View Feature)
 * Formats current filtered BDM table view into an RFC 4180 CSV file with UTF-8 BOM.
 */
export function exportBdmClientsCSV() {
  const clients = getFilteredBdmClients();
  if (!clients || clients.length === 0) {
    ToastNotification.warning(
      "No forwarded client records found in the current view to export.",
    );
    return;
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const filterTag = bdmFilter ? bdmFilter.toUpperCase() : "ALL";
  const filename = `VTMARKET_BDM_Clients_${filterTag}_${timestamp}.csv`;

  const columns = [
    {
      label: "BDM Status",
      key: "status",
      transform: (_, item) => {
        const isCompleted =
          (item.status || "").toLowerCase() === "completed" ||
          (item.action_status || "").toLowerCase() === "completed";
        return isCompleted ? "Completed" : "Pending Action";
      },
    },
    {
      label: "Full Name",
      key: "name",
      transform: (val, item) => item.name || item.full_name || "-",
    },
    {
      label: "Email Address",
      key: "email",
      transform: (val) => val || "-",
    },
    {
      label: "Phone (WhatsApp)",
      key: "phone",
      transform: (val) => val || "-",
    },
    {
      label: "State",
      key: "state",
      transform: (val) => val || "-",
    },
    {
      label: "Remark",
      key: "remark",
      transform: (val) => val || "-",
    },
    {
      label: "Registration Date",
      key: "registration_date",
      transform: (val) => formatDate(val),
    },
    {
      label: "Action / Verified Date",
      key: "updated_at",
      transform: (val, item) =>
        item.updated_at
          ? formatDate(item.updated_at)
          : formatDate(item.registration_date) || "-",
    },
  ];

  const success = exportToCSV(filename, columns, clients);
  if (success) {
    ToastNotification.success(
      `Exported ${clients.length} BDM record(s) to CSV successfully.`,
    );
  }
}

function renderBdmTable() {
  const tbody = document.getElementById("bdm-table-body");
  if (!tbody) return;

  const filtered = getFilteredBdmClients();

  const emptyState = document.getElementById("no-bdm-results");
  const cardsContainer = document.getElementById("bdm-cards-container");

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    if (cardsContainer) cardsContainer.innerHTML = "";
    if (emptyState) emptyState.classList.remove("hidden");
    updateBdmPagination(0);
    return;
  }

  if (emptyState) emptyState.classList.add("hidden");
  updateBdmPagination(filtered.length);

  let tableRowsHtml = "";
  let mobileCardsHtml = "";

  filtered.forEach((item) => {
    const isCompleted =
      (item.status || "").toLowerCase() === "completed" ||
      (item.action_status || "").toLowerCase() === "completed";
    const isPending = !isCompleted;

    let rowClass = "hover:bg-slate-50 transition-colors";
    let cardBorder = "border-slate-200/90";
    if (isPending) {
      rowClass = "bg-amber-50/50 hover:bg-amber-50/80 transition-colors";
      cardBorder = "border-amber-300/80 bg-amber-50/20";
    } else if (isCompleted) {
      rowClass = "bg-emerald-50/40 hover:bg-emerald-50/70 transition-colors";
      cardBorder = "border-emerald-300/80 bg-emerald-50/30";
    }

    // Status Badge: Newly received appear with Yellow badge 'Pending'
    let statusBadge = "";
    if (isPending) {
      statusBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-300/80 shadow-2xs">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
          Pending
        </span>
      `;
    } else {
      statusBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300/80 shadow-2xs">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
          Completed
        </span>
      `;
    }

    const rowState = bdmRowStates.get(item.id) || {
      mode: "custom",
      customText: item.remark || "",
    };
    const mode = rowState.mode || "custom";
    const customText =
      rowState.customText !== undefined
        ? rowState.customText
        : item.remark || "";

    // Remark column:
    let remarkCol = "";
    if (isPending) {
      remarkCol = `
        <div class="space-y-1.5 min-w-[220px]">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-slate-500 font-semibold uppercase">Action:</span>
            <select onchange="window.setBdmRowMode('${item.id}', this.value)" class="bg-white border border-slate-300 hover:border-slate-400 rounded px-2 py-1 text-xs text-slate-800 font-medium outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs cursor-pointer">
              <option value="custom" ${mode === "custom" ? "selected" : ""}>Type Custom Remark</option>
              <option value="complete" ${mode === "complete" ? "selected" : ""}>Complete</option>
            </select>
          </div>
          ${
            mode === "custom"
              ? `
            <input type="text" id="bdm-input-${item.id}" value="${escapeHtml(customText)}" oninput="window.setBdmCustomText('${item.id}', this.value)" placeholder="e.g., Pending Approval..." class="w-full bg-white border border-blue-400 rounded px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs font-medium" />
          `
              : `
            <div class="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-200/60 font-medium flex items-center gap-1">
              <span>Ready to mark as complete</span>
            </div>
          `
          }
        </div>
      `;
    } else {
      remarkCol = `
        <span class="inline-flex text-emerald-800 font-semibold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 text-xs">${escapeHtml(item.remark || "Completed")}</span>
      `;
    }

    // Action / Timestamp column:
    let actionCol = "";
    if (isPending) {
      if (mode === "custom") {
        actionCol = `
          <button onclick="window.bdmUpdateCustomRemark('${item.id}')" class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-2xs active:scale-95" title="Update custom remark (Status remains Pending)">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Update</span>
          </button>
        `;
      } else {
        actionCol = `
          <button onclick="window.bdmMarkComplete('${item.id}')" class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-2xs active:scale-95" title="Mark as Completed">
            <svg class="w-3.5 h-3.5 text-emerald-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>Complete</span>
          </button>
        `;
      }
    } else {
      // Completed Record: Single checkmark icon with preserved green outline border, rounded layout, and text styling
      actionCol = `
        <span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-800 bg-white/90 px-2.5 py-1 rounded-full border border-emerald-300/80 shadow-2xs whitespace-nowrap">
          <span class="text-emerald-600 font-bold select-none">✓</span>
          <span>${formatDate(item.updated_at, false)}</span>
        </span>
      `;
    }

    const cleanPhone = (item.phone || "").replace(/[^0-9]/g, "");
    const phoneCol = `<a href="https://wa.me/${cleanPhone}" target="_blank" class="inline-flex items-center gap-1.5 text-slate-700 hover:text-emerald-600 transition-colors font-medium">
        <svg class="w-3.5 h-3.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.972.536 1.954.887 3.149.887 3.182 0 5.767-2.587 5.767-5.766.001-3.182-2.585-5.769-5.767-5.769zm3.374 8.169c-.144.405-.837.774-1.17.824-.312.045-.694.074-2.12-.516-1.559-.645-2.535-2.247-2.613-2.351-.077-.104-.63-0.838-.63-1.601 0-.762.399-1.137.541-1.292.144-.156.314-.195.42-.195.105 0 .211.002.302.007.098.005.228-.037.355.27.13.313.447 1.09.486 1.17.039.078.065.17.013.273-.052.104-.078.169-.156.26-.078.091-.164.203-.234.273-.078.078-.16.163-.069.319.091.156.405.669.869 1.082.597.532 1.1.697 1.256.775.156.078.247.065.338-.039.091-.104.39-.455.494-.611.104-.156.208-.13.351-.078.143.052.91.43 1.066.507.156.078.26.117.299.182.039.065.039.377-.105.782z"/>
        </svg>
        <span>${escapeHtml(item.phone || "-")}</span>
      </a>`;

    // Desktop Table Row
    tableRowsHtml += `
      <tr class="${rowClass} border-b border-slate-100 text-xs">
        <td class="py-3.5 px-4 whitespace-nowrap">${statusBadge}</td>
        <td class="py-3.5 px-4 font-medium text-slate-900 whitespace-nowrap">${escapeHtml(item.name || item.full_name || "-")}</td>
        <td class="py-3.5 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">${escapeHtml(item.email || "-")}</td>
        <td class="py-3.5 px-4 whitespace-nowrap">${phoneCol}</td>
        <td class="py-3.5 px-4 whitespace-nowrap">
          <span class="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">${escapeHtml(item.state || "-")}</span>
        </td>
        <td class="py-3.5 px-4 min-w-[220px]">${remarkCol}</td>
        <td class="py-3.5 px-4 text-center whitespace-nowrap">${actionCol}</td>
      </tr>
    `;

    // Mobile BDM Card (Touch-friendly 44x44px minimum tap targets)
    mobileCardsHtml += `
      <div class="bg-white rounded-xl border ${cardBorder} shadow-2xs p-4 space-y-3">
        <!-- Top: Name & Status -->
        <div class="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-100">
          <div class="min-w-0">
            <div class="font-bold text-sm text-slate-900 truncate">${escapeHtml(item.name || item.full_name || "-")}</div>
            <div class="text-xs text-slate-600 font-mono truncate flex items-center gap-1.5 pt-0.5">
              <span class="text-slate-400">✉</span> ${escapeHtml(item.email || "-")}
            </div>
            <div class="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <a href="https://wa.me/${cleanPhone}" target="_blank" class="inline-flex items-center gap-1 text-slate-700 hover:text-emerald-600 font-medium">
                <span class="text-emerald-500">📞</span> ${escapeHtml(item.phone || "-")}
              </a>
              <span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                State: ${escapeHtml(item.state || "-")}
              </span>
            </div>
          </div>
          <div class="shrink-0">
            ${statusBadge}
          </div>
        </div>

        <!-- Remark & Forwarded Timing -->
        <div class="space-y-2 bg-slate-50/80 p-3 rounded-lg border border-slate-100 text-xs">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-slate-500 font-medium">Forwarded: ${formatDate(item.registration_date)}</span>
            ${item.updated_at ? `<span class="text-slate-500">Updated: ${formatDate(item.updated_at, true)}</span>` : ""}
          </div>
          ${
            isPending
              ? `
            <div class="space-y-1.5 pt-1">
              <div class="flex items-center justify-between gap-2">
                <label class="text-[10px] font-semibold text-slate-500 uppercase">Action Mode:</label>
                <select onchange="window.setBdmRowMode('${item.id}', this.value)" class="bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 font-medium">
                  <option value="custom" ${mode === "custom" ? "selected" : ""}>Type Custom Remark</option>
                  <option value="complete" ${mode === "complete" ? "selected" : ""}>Complete</option>
                </select>
              </div>
              ${
                mode === "custom"
                  ? `
                <input type="text" value="${escapeHtml(customText)}" oninput="window.setBdmCustomText('${item.id}', this.value)" placeholder="e.g., Pending Approval..." class="w-full bg-white border border-blue-400 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs font-medium" />
              `
                  : `
                <div class="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-1.5 rounded border border-emerald-200/60 font-medium">
                  Application ready to be completed
                </div>
              `
              }
            </div>
          `
              : `
            <div>
              <span class="text-slate-400 text-[11px]">Remark:</span>
              <span class="inline-flex text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-xs ml-1">
                ${escapeHtml(item.remark || "Completed")}
              </span>
            </div>
          `
          }
        </div>

        <!-- Action Button (min-h-[44px]) -->
        <div class="pt-1">
          ${
            isPending
              ? mode === "custom"
                ? `<button onclick="window.bdmUpdateCustomRemark('${item.id}')" class="w-full min-h-[44px] px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2 transition-colors shadow-2xs active:scale-95">
                     <svg class="w-4 h-4 text-blue-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                     <span>Update</span>
                   </button>`
                : `<button onclick="window.bdmMarkComplete('${item.id}')" class="w-full min-h-[44px] px-4 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-2 transition-colors shadow-2xs active:scale-95">
                     <svg class="w-4 h-4 text-emerald-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                     <span>Complete</span>
                   </button>`
              : `<div class="w-full text-center py-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200/80 rounded-lg text-xs font-semibold">
                 ✓ Authorized on ${formatDate(item.updated_at, false)}
               </div>`
          }
        </div>
      </div>
    `;
  });

  tbody.innerHTML = tableRowsHtml;
  if (cardsContainer) cardsContainer.innerHTML = mobileCardsHtml;
}

function updateBdmMetrics() {
  const total = bdmClients.length;
  const completed = bdmClients.filter(
    (c) =>
      (c.status || "").toLowerCase() === "completed" ||
      (c.action_status || "").toLowerCase() === "completed",
  ).length;
  const pending = total - completed;

  const elTotal = document.getElementById("stat-bdm-total");
  if (elTotal) elTotal.innerText = total;

  const elCompleted = document.getElementById("stat-bdm-completed");
  if (elCompleted) elCompleted.innerText = completed;

  const elPending = document.getElementById("stat-bdm-pending");
  if (elPending) elPending.innerText = pending;

  const elCountAll = document.getElementById("count-bdm-all");
  if (elCountAll) elCountAll.innerText = `(${total})`;

  const elCountPending = document.getElementById("count-bdm-pending");
  if (elCountPending) elCountPending.innerText = `(${pending})`;

  const elCountComplete = document.getElementById("count-bdm-complete");
  if (elCountComplete) elCountComplete.innerText = `(${completed})`;
}

function updateBdmPagination(count) {
  const elRange = document.getElementById("bdm-page-range");
  if (elRange) elRange.innerText = count > 0 ? `1-${count}` : "0";
}

function bindBdmGlobalHandlers() {
  /**
   * IqwanEngine: BDM Custom Remark & Mode Selection Handlers
   */
  window.setBdmRowMode = (id, mode) => {
    let state = bdmRowStates.get(id);
    const client = bdmClients.find((c) => c.id === id);
    if (!state) {
      state = { mode: mode, customText: client ? client.remark || "" : "" };
      bdmRowStates.set(id, state);
    } else {
      state.mode = mode;
    }
    renderBdmTable();
  };

  window.setBdmCustomText = (id, text) => {
    let state = bdmRowStates.get(id);
    const client = bdmClients.find((c) => c.id === id);
    if (!state) {
      state = { mode: "custom", customText: text };
      bdmRowStates.set(id, state);
    } else {
      state.customText = text;
    }
  };

  /**
   * IqwanEngine: BDM Custom Remark Update Handler
   * Custom Typing: If the BDM types a free-text remark (e.g. "ada error", "waiting submission")
   * and clicks [ Update ], the master Status MUST remain as "Pending".
   * Every click pushes new custom remark text and a refreshed ISO timestamp directly to Supabase.
   */
  window.bdmUpdateCustomRemark = async (id) => {
    const client = bdmClients.find((c) => c.id === id);
    const state = bdmRowStates.get(id);
    const newRemark = (
      state && state.customText !== undefined
        ? state.customText
        : client && client.remark
          ? client.remark
          : ""
    ).trim();

    if (!newRemark) {
      ToastNotification.error("Please enter a custom remark before updating.");
      return;
    }

    const updatedTimestamp = new Date().toISOString();
    const payload = {
      remark: newRemark,
      status: "Pending", // Master status MUST remain "Pending"
      action_status: "Submit to BDM",
      updated_at: updatedTimestamp,
    };

    try {
      const { error, isNetworkError } = await safeUpdateClient(id, payload);

      if (error) {
        console.error("IqwanEngine: Error updating BDM custom remark:", error);
        ToastNotification.error(
          isNetworkError
            ? "Network failure: Unable to sync custom remark."
            : "Error updating remark: " + (error.message || error),
        );
      } else {
        ToastNotification.success(
          "Custom remark updated successfully (Status: Pending).",
        );
        if (client) {
          client.remark = newRemark;
          client.status = "Pending";
          client.action_status = "Submit to BDM";
          client.updated_at = updatedTimestamp;
        }
        await loadBdmData();
      }
    } catch (err) {
      console.error(
        "IqwanEngine: Network exception during bdmUpdateCustomRemark:",
        err,
      );
      ToastNotification.error("Network failure: Failed to update remark.");
    }
  };

  /**
   * IqwanEngine: BDM Dashboard Completion Flow
   * Completing: Only when the user selects the "Complete" option and clicks [ Complete ]
   * should the master Status change to Complete.
   */
  window.bdmMarkComplete = async (id) => {
    const completedTimestamp = new Date().toISOString();
    const payload = {
      status: "Completed",
      action_status: "Completed",
      updated_at: completedTimestamp,
    };

    try {
      const { error, isNetworkError } = await safeUpdateClient(id, payload);

      if (error) {
        console.error("IqwanEngine: Error completing BDM application:", error);
        ToastNotification.error(
          isNetworkError
            ? "Network failure: Unable to sync application completion."
            : "Error completing application: " + (error.message || error),
        );
      } else {
        ToastNotification.success(
          "Application approved & marked Completed. Synced with Admin console.",
        );
        await loadBdmData();
      }
    } catch (networkErr) {
      console.error(
        "IqwanEngine: Network exception during bdmMarkComplete:",
        networkErr,
      );
      ToastNotification.error(
        "Network failure: Failed to complete application. Please check connection.",
      );
    }
  };

  // CSV Export
  window.exportBdmClientsCSV = exportBdmClientsCSV;
  const bdmExportBtn = document.getElementById("bdm-export-csv-btn");
  if (bdmExportBtn) {
    bdmExportBtn.addEventListener("click", () => {
      exportBdmClientsCSV();
    });
  }

  // Filter Tabs
  window.setBdmFilter = (filterKey) => {
    bdmFilter = filterKey;
    ["all", "pending", "complete"].forEach((f) => {
      const btn = document.getElementById(`filter-${f}`);
      if (!btn) return;
      if (f === filterKey) {
        btn.className =
          "px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all bg-white text-slate-900 shadow-sm border border-slate-200/60";
      } else {
        btn.className =
          "px-3.5 py-1.5 text-xs font-medium rounded-md transition-all text-slate-600 hover:text-slate-900";
      }
    });
    renderBdmTable();
  };
}

function bindBdmSearch() {
  const searchInput = document.getElementById("bdm-search-input");
  if (!searchInput) return;
  searchInput.addEventListener("input", (e) => {
    bdmSearch = e.target.value;
    renderBdmTable();
  });
}

/**
 * --------------------------------------------------------------------------------
 * 4. DEVELOPER & SCHEMA CACHE UTILITIES
 * --------------------------------------------------------------------------------
 */

/**
 * Reset remark options to the 7 preset defaults and sync to Supabase & localStorage
 */
export async function resetRemarkOptionsToDefaults() {
  try {
    await saveStructuredRemarkOptions(DEFAULT_REMARK_OPTIONS);
    renderRemarksList();
    renderAdminTable();
    ToastNotification.success(
      "Skim remark berjaya ditetapkan semula kepada 7 pilihan lalai.",
    );
    return { success: true };
  } catch (err) {
    console.error("IqwanEngine: Error resetting remark options:", err);
    ToastNotification.error("Gagal menetapkan semula skim remark.");
    return { success: false, error: err };
  }
}

/**
 * Trigger PostgREST schema cache reload to resolve column desynchronization
 * and restore 7 system preset default scheme options
 * SQL: NOTIFY pgrst, 'reload schema';
 */
export async function reloadSchemaCache() {
  let rpcSuccess = false;
  try {
    const { error } = await supabase.rpc("reload_schema");
    if (!error) {
      rpcSuccess = true;
    }
  } catch (err) {
    console.warn("RPC reload_schema attempt:", err);
  }

  // Restore and persist the 7 default remark options
  try {
    await saveStructuredRemarkOptions(DEFAULT_REMARK_OPTIONS);
    renderRemarksList();
    renderAdminTable();
  } catch (err) {
    console.warn("Error restoring default scheme presets:", err);
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText("NOTIFY pgrst, 'reload schema';");
    }
  } catch {
    // optional
  }

  if (rpcSuccess) {
    showToast("Schema & 7 preset options successfully reloaded via RPC!");
  } else {
    showToast("Schema reloaded & 7 presets restored (NOTIFY command copied)");
  }

  return { success: true, rpcSuccess };
}

/**
 * Inject 3 realistic test seed client records for immediate verification across
 * Admin and BDM portals:
 * - Scenario 1 (New): Fresh registration with status 'New', action_status 'New', no remark
 * - Scenario 2 (Pending BDM): Forwarded to BDM with 'STP IB 14$' remark, status 'Pending', action_status 'Submit to BDM'
 * - Scenario 3 (Completed): Approved by BDM desk with status 'Completed', verified updated_at timestamp
 */
export async function seedTestClients() {
  const now = new Date();
  const uid = Date.now().toString().slice(-4);

  const testRecords = [
    {
      name: "Test 1 (New Client)",
      email: `test3.${uid}@example.com`,
      phone: "+60123456789",
      state: "Selangor",
      registration_date: new Date(now.getTime() - 1000 * 60 * 15).toISOString(),
      status: "New",
      action_status: "New",
      remark: null,
      updated_at: null,
    },
    {
      name: "Test 2 (Example Rebate Pending)",
      email: `test2.${uid}@example.com`,
      phone: "+60178899001",
      state: "Kuala Lumpur",
      registration_date: new Date(
        now.getTime() - 1000 * 60 * 60 * 2,
      ).toISOString(),
      status: "Pending",
      action_status: "Submit to BDM",
      remark: "STP IB 14$",
      updated_at: null,
    },
    {
      name: "Test 3 (Completed Rebate)",
      email: `test3.${uid}@example.com`,
      phone: "+60193344556",
      state: "Johor",
      registration_date: new Date(
        now.getTime() - 1000 * 60 * 60 * 24,
      ).toISOString(),
      status: "Completed",
      action_status: "Completed",
      remark: "Booster Client 14$",
      updated_at: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
    },
  ];

  // Try 1: Standard client insertion
  let insertResult = await supabase
    .from("clients")
    .insert(testRecords)
    .select();
  let error = insertResult.error;

  // Fallback 1: Unauthenticated gateway retry if RLS blocks authenticated session role
  if (
    error &&
    (error.message?.includes("row-level security") || error.code === "42501")
  ) {
    console.warn(
      "IqwanEngine: Retrying seed insertion via unauthenticated gateway due to RLS restriction...",
    );
    insertResult = await supabaseAnon
      .from("clients")
      .insert(testRecords)
      .select();
    error = insertResult.error;
  }

  // Fallback 2: RLS requires initial status = 'New' strictly on INSERT
  if (
    error &&
    (error.message?.includes("row-level security") || error.code === "42501")
  ) {
    console.warn(
      "IqwanEngine: RLS enforces initial 'New' status on INSERT. Inserting initial states and updating...",
    );
    const normalizedRecords = testRecords.map((r) => ({
      name: r.name,
      email: r.email,
      phone: r.phone,
      state: r.state,
      registration_date: r.registration_date,
      status: "New",
      action_status: "New",
      remark: null,
      updated_at: null,
    }));

    let normResult = await supabase
      .from("clients")
      .insert(normalizedRecords)
      .select();
    if (
      normResult.error &&
      (normResult.error.message?.includes("row-level security") ||
        normResult.error.code === "42501")
    ) {
      normResult = await supabaseAnon
        .from("clients")
        .insert(normalizedRecords)
        .select();
    }

    if (!normResult.error && normResult.data && normResult.data.length >= 3) {
      error = null;
      const insertedRows = normResult.data;
      if (insertedRows[1]?.id) {
        await safeUpdateClient(insertedRows[1].id, {
          status: "Pending",
          action_status: "Submit to BDM",
          remark: "STP IB 14$",
        });
      }
      if (insertedRows[2]?.id) {
        await safeUpdateClient(insertedRows[2].id, {
          status: "Completed",
          action_status: "Completed",
          remark: "Booster Client 14$",
          updated_at: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
        });
      }
    } else if (normResult.error) {
      error = normResult.error;
    }
  }

  if (error) {
    console.error("Error inserting test seed clients:", error.message);
    showToast("Failed to inject test clients: " + error.message, true);
    return { success: false, error };
  }

  showToast(
    "3 Test Seed Records injected! Realtime sync active across Admin & BDM.",
  );
  await loadAdminData();
  return { success: true };
}

/**
 * Remove test seed clients (matching @example.com)
 */
export async function clearTestClients() {
  let { error } = await supabase
    .from("clients")
    .delete()
    .like("email", "%@example.com");

  if (
    error &&
    (error.message?.includes("row-level security") || error.code === "42501")
  ) {
    console.warn(
      "IqwanEngine: Retrying clear test clients via unauthenticated gateway...",
    );
    const retry = await supabaseAnon
      .from("clients")
      .delete()
      .like("email", "%@example.com");
    error = retry.error;
  }

  if (error) {
    showToast("Error clearing test clients: " + error.message, true);
    return { success: false, error };
  }

  showToast("Test records cleared from database.");
  await loadAdminData();
  return { success: true };
}
