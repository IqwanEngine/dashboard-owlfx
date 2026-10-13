/**
 * ================================================================================
 * IqwanEngine VT Market Ecosystem
 * Module: Centralized Toast Notification System (ui.js)
 * Architecture: Tailwind CSS Dynamic Feedback Controller
 * Crafted with precision by IqwanEngine
 * ================================================================================
 */

/**
 * IqwanEngine ToastNotification System
 * Centralized, responsive toast feedback for all Supabase database & network operations.
 */
export class ToastNotification {
  static containerId = "iqwan-toast-container";
  static activeTimeouts = new Map();

  /**
   * Ensure a dedicated high-z-index Tailwind container exists in the DOM
   */
  static getOrCreateContainer() {
    let container = document.getElementById(this.containerId);
    if (!container) {
      container = document.createElement("div");
      container.id = this.containerId;
      container.className =
        "fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0";
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Render and display a toast notification
   * @param {Object} options
   * @param {string} options.message - Notification message text
   * @param {'success'|'error'|'info'|'warning'} [options.type='success'] - Toast variant
   * @param {number} [options.duration=3500] - Duration in ms
   */
  static show({ message, type = "success", duration = 3500 }) {
    if (!message) return;

    // Synchronize with existing legacy DOM element if present on current page
    this.syncLegacyToast(message, type, duration);

    const container = this.getOrCreateContainer();
    const toastId =
      "toast-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);

    const toastEl = document.createElement("div");
    toastEl.id = toastId;
    toastEl.setAttribute("role", "alert");

    // Variant color configurations
    let variantClasses = "";
    let iconSvg = "";
    let borderAccent = "";

    switch (type) {
      case "error":
        variantClasses =
          "bg-slate-900 text-rose-50 border-rose-500/80 shadow-rose-950/40";
        borderAccent = "border-l-4 border-l-rose-500";
        iconSvg = `
          <div class="w-7 h-7 rounded-lg bg-rose-500/15 flex items-center justify-center shrink-0 text-rose-400">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 7.5h.008v.008H12v-.008z" />
            </svg>
          </div>
        `;
        break;

      case "warning":
        variantClasses =
          "bg-slate-900 text-amber-50 border-amber-500/80 shadow-amber-950/40";
        borderAccent = "border-l-4 border-l-amber-500";
        iconSvg = `
          <div class="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 text-amber-400">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        `;
        break;

      case "info":
        variantClasses =
          "bg-slate-900 text-blue-50 border-blue-500/80 shadow-blue-950/40";
        borderAccent = "border-l-4 border-l-blue-500";
        iconSvg = `
          <div class="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0 text-blue-400">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
          </div>
        `;
        break;

      case "success":
      default:
        variantClasses =
          "bg-slate-900 text-emerald-50 border-emerald-500/70 shadow-emerald-950/40";
        borderAccent = "border-l-4 border-l-emerald-500";
        iconSvg = `
          <div class="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0 text-emerald-400">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
        `;
        break;
    }

    toastEl.className = `pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-300 ease-out transform translate-y-2 opacity-0 scale-95 ${variantClasses} ${borderAccent}`;

    toastEl.innerHTML = `
      ${iconSvg}
      <div class="flex-1 pt-0.5 text-xs font-medium leading-relaxed break-words pr-1">
        ${escapeHtml(message)}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        class="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors shrink-0"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;

    // Bind dismiss action
    const closeBtn = toastEl.querySelector("button");
    const dismiss = () => {
      toastEl.classList.add("opacity-0", "translate-y-2", "scale-95");
      setTimeout(() => {
        if (toastEl.parentNode) {
          toastEl.parentNode.removeChild(toastEl);
        }
      }, 300);
      if (this.activeTimeouts.has(toastId)) {
        clearTimeout(this.activeTimeouts.get(toastId));
        this.activeTimeouts.delete(toastId);
      }
    };

    if (closeBtn) {
      closeBtn.addEventListener("click", dismiss);
    }

    container.appendChild(toastEl);

    // Trigger enter transition
    requestAnimationFrame(() => {
      toastEl.classList.remove("translate-y-2", "opacity-0", "scale-95");
      toastEl.classList.add("translate-y-0", "opacity-100", "scale-100");
    });

    // Schedule auto-dismiss
    const timeout = setTimeout(dismiss, duration);
    this.activeTimeouts.set(toastId, timeout);

    return toastEl;
  }

  /**
   * Helper: Success toast
   */
  static success(message, duration = 3500) {
    return this.show({ message, type: "success", duration });
  }

  /**
   * Helper: Error toast (e.g. Supabase errors & Network failures)
   */
  static error(message, duration = 4500) {
    return this.show({ message, type: "error", duration });
  }

  /**
   * Helper: Warning toast
   */
  static warning(message, duration = 4000) {
    return this.show({ message, type: "warning", duration });
  }

  /**
   * Helper: Info toast
   */
  static info(message, duration = 3500) {
    return this.show({ message, type: "info", duration });
  }

  /**
   * Sync with existing static DOM toast if present on older pages
   */
  static syncLegacyToast(message, type, duration) {
    const legacyToast =
      document.getElementById("toast") || document.getElementById("bdm-toast");
    if (!legacyToast) return;

    const msgSpan =
      legacyToast.querySelector("#toast-message") ||
      legacyToast.querySelector("#bdm-toast-message") ||
      legacyToast.querySelector("span");

    if (msgSpan) msgSpan.innerText = message;

    const isError = type === "error";
    if (isError) {
      legacyToast.classList.remove("border-slate-800", "bg-slate-900");
      legacyToast.classList.add("border-rose-800", "bg-rose-950");
    } else {
      legacyToast.classList.remove("border-rose-800", "bg-rose-950");
      legacyToast.classList.add("border-slate-800", "bg-slate-900");
    }

    legacyToast.classList.remove("translate-y-20", "opacity-0");
    legacyToast.classList.add("translate-y-0", "opacity-100");

    setTimeout(() => {
      legacyToast.classList.add("translate-y-20", "opacity-0");
      legacyToast.classList.remove("translate-y-0", "opacity-100");
    }, duration);
  }
}

/**
 * Universal showToast wrapper for seamless drop-in backwards compatibility
 * @param {string} message
 * @param {boolean|string} isErrorOrType - true/'error' for error, false/'success' for success
 * @param {number} duration
 */
export function showToast(message, isErrorOrType = false, duration = 3500) {
  if (isErrorOrType === true || isErrorOrType === "error") {
    return ToastNotification.error(message, duration || 4500);
  }
  if (isErrorOrType === "warning") {
    return ToastNotification.warning(message, duration || 4000);
  }
  if (isErrorOrType === "info") {
    return ToastNotification.info(message, duration || 3500);
  }
  return ToastNotification.success(message, duration || 3500);
}

/**
 * Basic HTML escaping helper
 */
function escapeHtml(str) {
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

// Global browser window registrations
if (typeof window !== "undefined") {
  window.ToastNotification = ToastNotification;
  window.showToast = showToast;
}
