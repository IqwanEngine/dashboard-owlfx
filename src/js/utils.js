/**
 * ================================================================================
 * IqwanEngine PU Prime Ecosystem
 * Module: Core Utilities & Dynamic System Settings Engine (utils.js)
 * Architecture: Database-Backed Configuration Cache & State Machine Router
 * Crafted with precision by IqwanEngine
 * Zero localStorage: Fully Supabase-backed Enterprise Settings Cache
 * ================================================================================
 */

import { supabase } from "./supabase.js";

/**
 * IqwanEngine: Structured Remark Options Data Model
 * @typedef {Object} RemarkOption
 * @property {string} id - Unique identifier
 * @property {string} label - Remark display text (e.g., "$14USD / 1Lot", "No Rebate")
 * @property {"Submit to BDM" | "Do Nothing"} targetAction - Routing target
 */

export const DEFAULT_ADMIN_WA =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_DEFAULT_ADMIN_WHATSAPP) ||
  (typeof process !== "undefined" && process.env?.VITE_DEFAULT_ADMIN_WHATSAPP) ||
  "+60102263677";

/**
 * Default Seed Options conforming strictly to the RemarkOption interface
 * @type {RemarkOption[]}
 */
export const DEFAULT_REMARK_OPTIONS = [
  { id: "1", label: "$14USD / 1Lot", targetAction: "Submit to BDM" },
  { id: "2", label: "No Rebate", targetAction: "Do Nothing" },
  { id: "3", label: "Not Register Yet", targetAction: "Do Nothing" },
  { id: "4", label: "Others", targetAction: "Do Nothing" },
];

// In-memory runtime cache for system settings
let cachedRemarkOptions = [...DEFAULT_REMARK_OPTIONS];
let cachedAdminWhatsApp = DEFAULT_ADMIN_WA;
let isSettingsSynced = false;

/**
 * Fetch and sync system settings from Supabase table 'system_settings'
 * Updates in-memory runtime caches (cachedRemarkOptions & cachedAdminWhatsApp)
 * @returns {Promise<{ success: boolean, error?: any }>}
 */
export async function syncSystemSettingsFromDB() {
  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("setting_key, setting_value");

    if (error) {
      console.warn("IqwanEngine: Warning fetching system_settings from DB:", error.message);
      return { success: false, error };
    }

    if (data && Array.isArray(data)) {
      data.forEach((row) => {
        if (row.setting_key === "remark_options") {
          let val = row.setting_value;
          if (typeof val === "string") {
            try {
              val = JSON.parse(val);
            } catch (_) {}
          }
          if (Array.isArray(val) && val.length > 0) {
            cachedRemarkOptions = val.map((item, idx) => ({
              id: item.id || String(idx + 1),
              label: item.label || "Remark",
              targetAction: item.targetAction === "Submit to BDM" ? "Submit to BDM" : "Do Nothing",
            }));
          }
        } else if (row.setting_key === "admin_whatsapp") {
          let val = row.setting_value;
          if (typeof val === "string") {
            if (val.startsWith('"') && val.endsWith('"')) {
              try {
                val = JSON.parse(val);
              } catch (_) {}
            }
          }
          if (typeof val === "string" && val.trim()) {
            cachedAdminWhatsApp = val.trim();
          }
        }
      });
      isSettingsSynced = true;
    }
    return { success: true };
  } catch (err) {
    console.warn("IqwanEngine: Exception syncSystemSettingsFromDB:", err);
    return { success: false, error: err };
  }
}

/**
 * Retrieve all configured remark options from the in-memory cache.
 * Falls back to default seed options if cache is uninitialized.
 * @returns {RemarkOption[]}
 */
export function getStructuredRemarkOptions() {
  if (Array.isArray(cachedRemarkOptions) && cachedRemarkOptions.length > 0) {
    return [...cachedRemarkOptions];
  }
  return [...DEFAULT_REMARK_OPTIONS];
}

/**
 * Persist structured RemarkOption records to Supabase 'system_settings' table
 * and update in-memory cache.
 * @param {RemarkOption[]} options
 * @returns {Promise<{ success: boolean, error?: any }>}
 */
export async function saveStructuredRemarkOptions(options) {
  const normalized = (options || []).map((o, idx) => ({
    id: o.id || String(idx + 1),
    label: o.label || "Remark",
    targetAction: o.targetAction === "Submit to BDM" ? "Submit to BDM" : "Do Nothing",
  }));

  // Update in-memory cache immediately
  cachedRemarkOptions = normalized;

  try {
    const { error } = await supabase
      .from("system_settings")
      .upsert(
        {
          setting_key: "remark_options",
          setting_value: normalized,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" }
      );

    if (error) {
      console.error("IqwanEngine: Error saving remark options to Supabase:", error.message);
      return { success: false, error };
    }
    return { success: true };
  } catch (err) {
    console.error("IqwanEngine: Exception saving remark options to Supabase:", err);
    return { success: false, error: err };
  }
}

/**
 * Retrieve the admin WhatsApp number from in-memory cache.
 * @returns {string}
 */
export function getAdminWhatsApp() {
  if (cachedAdminWhatsApp && cachedAdminWhatsApp.trim()) {
    return cachedAdminWhatsApp.trim();
  }
  return DEFAULT_ADMIN_WA;
}

/**
 * Persist administrative WhatsApp number to Supabase 'system_settings' table
 * and update in-memory cache.
 * @param {string} num
 * @returns {Promise<{ success: boolean, error?: any }>}
 */
export async function saveAdminWhatsApp(num) {
  const clean = (num || "").trim() || DEFAULT_ADMIN_WA;
  cachedAdminWhatsApp = clean;

  try {
    const { error } = await supabase
      .from("system_settings")
      .upsert(
        {
          setting_key: "admin_whatsapp",
          setting_value: clean,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" }
      );

    if (error) {
      console.error("IqwanEngine: Error saving admin whatsapp to Supabase:", error.message);
      return { success: false, error };
    }
    return { success: true };
  } catch (err) {
    console.error("IqwanEngine: Exception saving admin whatsapp to Supabase:", err);
    return { success: false, error: err };
  }
}

/**
 * Dynamic targetAction resolution for a given remark label.
 * Looks up against dynamic RemarkOption in-memory repository with zero hardcoded comparisons.
 * @param {string} remarkLabel
 * @returns {"Submit to BDM" | "Do Nothing"}
 */
export function getRemarkTargetAction(remarkLabel) {
  if (!remarkLabel) return "Do Nothing";
  const options = getStructuredRemarkOptions();
  const normalized = remarkLabel.trim().toLowerCase();

  const found = options.find(
    (o) => (o.label || "").trim().toLowerCase() === normalized
  );

  if (found) {
    return found.targetAction;
  }

  // If a custom remark wasn't found in dynamic repository, infer from any registered option keywords
  const matchedPartial = options.find((o) => {
    const labelLower = (o.label || "").trim().toLowerCase();
    return normalized.includes(labelLower) || labelLower.includes(normalized);
  });

  if (matchedPartial) {
    return matchedPartial.targetAction;
  }

  return "Do Nothing";
}

/**
 * ================================================================================
 * IqwanEngine Core Function: updateRemarkEngine
 * ================================================================================
 * Implements the dynamic RemarkOption interface lookup logic.
 * Processes the targetAction (Submit to BDM vs Do Nothing) dynamically so that any
 * custom remarks added by admins are properly routed without hardcoded string comparisons.
 *
 * @param {string|Object} remarkInput - Remark label string or RemarkOption registration object
 * @param {Object} [context={}] - Optional override parameters
 * @returns {Object} Workflow state resolution
 */
export function updateRemarkEngine(remarkInput, context = {}) {
  // If invoked to add or update an option definition
  if (remarkInput && typeof remarkInput === "object" && remarkInput.label) {
    const options = getStructuredRemarkOptions();
    const existingIndex = options.findIndex(
      (o) =>
        (o.id && o.id === remarkInput.id) ||
        (o.label || "").toLowerCase() === (remarkInput.label || "").toLowerCase()
    );

    const newOption = {
      id: remarkInput.id || String(Date.now()),
      label: String(remarkInput.label).trim(),
      targetAction:
        remarkInput.targetAction === "Submit to BDM" ? "Submit to BDM" : "Do Nothing",
    };

    if (existingIndex >= 0) {
      options[existingIndex] = newOption;
    } else {
      options.push(newOption);
    }

    saveStructuredRemarkOptions(options);
    return {
      success: true,
      option: newOption,
      allOptions: options,
    };
  }

  // Standard Workflow Resolution Flow:
  const remarkLabel = typeof remarkInput === "string" ? remarkInput.trim() : "";
  const dynamicOptions = getStructuredRemarkOptions();
  const normalizedSearch = remarkLabel.toLowerCase();

  // Dynamic Lookup against RemarkOption collection
  const matchedOption = dynamicOptions.find(
    (o) => (o.label || "").trim().toLowerCase() === normalizedSearch
  );

  let targetAction = "Do Nothing";

  if (matchedOption) {
    targetAction = matchedOption.targetAction;
  } else if (context.targetAction) {
    targetAction = context.targetAction;
  } else {
    // Dynamic fallback lookup without hardcoded specific tier values
    targetAction = getRemarkTargetAction(remarkLabel);
  }

  const isBdmQueue = targetAction === "Submit to BDM";

  // Build the complete, deterministic state machine payload
  return {
    remark: remarkLabel,
    targetAction,
    isBdmQueue,
    isDirectComplete: !isBdmQueue,
    status: isBdmQueue ? "Pending" : "Completed",
    action_status: isBdmQueue ? "Submit to BDM" : "Completed",
    updated_at: isBdmQueue ? null : new Date().toISOString(),
    matchedOption: matchedOption || null,
  };
}

/**
 * Register helper methods directly onto updateRemarkEngine for ergonomic access
 */
updateRemarkEngine.getOptions = getStructuredRemarkOptions;
updateRemarkEngine.saveOptions = saveStructuredRemarkOptions;
updateRemarkEngine.getTargetAction = getRemarkTargetAction;

/**
 * Dynamically register a new custom remark tier created by an administrator
 * @param {string} label
 * @param {"Submit to BDM" | "Do Nothing"} targetAction
 */
updateRemarkEngine.registerOption = (label, targetAction = "Do Nothing") => {
  return updateRemarkEngine({ label, targetAction });
};

/**
 * Dynamically remove a custom remark option by id or label
 * @param {string} idOrLabel
 */
updateRemarkEngine.removeOption = async (idOrLabel) => {
  let options = getStructuredRemarkOptions();
  options = options.filter(
    (o) => o.id !== idOrLabel && o.label.toLowerCase() !== String(idOrLabel).toLowerCase()
  );
  if (options.length === 0) {
    options = [...DEFAULT_REMARK_OPTIONS];
  }
  await saveStructuredRemarkOptions(options);
  return options;
};

/**
 * Utility: Format ISO timestamp to clean readable string with optional checkmark
 * e.g. "✓ 12 Oct 2026, 03:28 AM" or "11 Oct 2026, 09:00 AM"
 */
export function formatDate(isoString, withCheckmark = false) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    const dateFormatted =
      d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }) +
      ", " +
      d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    return withCheckmark ? `✓ ${dateFormatted}` : dateFormatted;
  } catch {
    return String(isoString);
  }
}

/**
 * Utility: HTML Escape string to prevent XSS
 */
export function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[m];
  });
}

/**
 * IqwanEngine Institutional Data Export:
 * Format and download an array of objects into an RFC 4180 compliant CSV file.
 * Automatically prepends UTF-8 Byte Order Mark (\uFEFF) for native MS Excel and Google Sheets compatibility.
 *
 * @param {string} filename - Filename with .csv extension
 * @param {Array<{label: string, key?: string, transform?: (val: any, row: any) => any}>} columns - Column configuration
 * @param {Array<Object>} rows - Data rows
 * @returns {boolean} Whether export succeeded
 */
export function exportToCSV(filename, columns, rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  // RFC 4180 cell escaping
  const escapeCsvCell = (value) => {
    if (value === null || value === undefined) return "";
    let str = String(value);
    if (/[",\r\n]/.test(str)) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build header row
  const headerLine = columns.map((col) => escapeCsvCell(col.label)).join(",");

  // Build data lines
  const dataLines = rows.map((row) => {
    return columns
      .map((col) => {
        let val = col.key ? row[col.key] : "";
        if (typeof col.transform === "function") {
          val = col.transform(val, row);
        }
        return escapeCsvCell(val);
      })
      .join(",");
  });

  const csvContent = "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", blobUrl);
  link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 1000);

  return true;
}

// Global browser window registrations
if (typeof window !== "undefined") {
  window.updateRemarkEngine = updateRemarkEngine;
  window.getStructuredRemarkOptions = getStructuredRemarkOptions;
  window.getRemarkTargetAction = getRemarkTargetAction;
  window.getAdminWhatsApp = getAdminWhatsApp;
  window.saveAdminWhatsApp = saveAdminWhatsApp;
  window.syncSystemSettingsFromDB = syncSystemSettingsFromDB;
  window.exportToCSV = exportToCSV;
}

