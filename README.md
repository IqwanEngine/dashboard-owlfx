# 🦅 IqwanEngine — Institutional CRM & Partner Ecosystem

[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase_PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Architecture](https://img.shields.io/badge/Security-Zero--Trust_RBAC-blue?style=for-the-badge)](#-security-architecture--access-control)

A high-performance, real-time institutional client management portal and partner ecosystem engineered for institutional trading operations. Built on Vite, Tailwind CSS, and Supabase Realtime PostgreSQL, this application delivers end-to-end client onboarding, remark classification, BDM pipeline triage, and zero-leakage role-based security.

---

## 📑 Table of Contents

- [Architectural Overview](#-architectural-overview)
- [Key Modules](#-key-modules)
- [Security Architecture & Access Control](#-security-architecture--access-control)
- [Directory Structure](#-directory-structure)
- [Deployment & Environment Setup](#-deployment--environment-setup)
- [Operational Workflow (SOP)](#-operational-workflow-sop)
- [Tech Stack](#-tech-stack)
- [License & Intellectual Property](#-license--intellectual-property)

---

## 🏛️ Architectural Overview

IqwanEngine implements a decoupled, event-driven architecture designed around strict client-broker isolation:

```text
[ Client Registration ]
         │
         ▼
[ PostgreSQL Engine ] ──(Realtime WebSocket)──► [ Superadmin Command Center ]
         │                                              │
  (Non-Recursive RLS)                               (Pipeline Triage)
         │                                              │
         ▼                                              ▼
[ Profile Verification ] ◄───────────────────── [ BDM Partner Portal ]
```

- **Client Layer**: Public-facing registration gateway for instant MT4/MT5 onboarding.
- **Data Engine**: Supabase PostgreSQL with real-time replication and audit event tracking.
- **Access Boundary**: Role-Based Access Control (RBAC) enforced exclusively at the database layer using non-recursive Row Level Security (RLS).

---

## ⚡ Key Modules

### 1. Dual-Portal Interface

- **Superadmin Command Center (`dashboard-admin.html`)**: Complete administrative operations panel featuring client pipeline monitoring, dynamic remark configuration, system WhatsApp gateway management, batch record mutations, and audit-safe CSV exports.
- **Institutional BDM Portal (`dashboard-bdm.html`)**: Dedicated partner pipeline optimized for fast triage workflows (`Submit to BDM` $\rightarrow$ `Reviewed` $\rightarrow$ `Action Taken`), rebate confirmation, and broker note verification.
- **Client Onboarding Gateway (`daftar.html`)**: High-conversion public onboarding interface collecting trading account configurations, broker choices, and intake requests.
- **Authentication Gatekeeper (`index.html`)**: Hardened entry point performing cryptographic identity validation and role-directed session dispatching.

### 2. Real-Time Settings & Event Engine

- **Sub-Second Replication**: Multi-client data synchronization via persistent Supabase WebSocket channels.
- **Dynamic Configuration Registry**: Run-time reconfigurable remark tiers (e.g., customized rebate and account tiers) and dynamic administrator contact routes stored in `system_settings`.
- **Auditing Badge System**: Chronological confirmation stamps (`✓ DD MMM YYYY, hh:mm A`) generated automatically upon status transitions.

---

## 🛡️ Security Architecture & Access Control

IqwanEngine enforces a defense-in-depth model where authorization is never delegated to the client browser.

```text
┌────────────────────────────────────────────────────────┐
│                 Client Browser Layer                   │
│   Synchronous Anti-FOUC Guards + Strict Form Hygiene   │
└──────────────────────────┬─────────────────────────────┘
                           │ Authenticated JWT
┌──────────────────────────▼─────────────────────────────┐
│                 Supabase Auth Gateway                  │
│       Encrypted Credential & Session Validation        │
└──────────────────────────┬─────────────────────────────┘
                           │ Verified UID
┌──────────────────────────▼─────────────────────────────┐
│              PostgreSQL Row Level Security             │
│   Non-Recursive Functions (SECURITY DEFINER + RLS OFF) │
└────────────────────────────────────────────────────────┘
```

### 1. Zero-Exposure Identity Principle

- **Sanitized Client Views**: Personal email identifiers and credentials are stripped from client-side bundles, dynamic DOM elements, and console telemetry.
- **Ephemeral Authentication Context**: User accounts are resolved purely via cryptographically signed JWT tokens and internal user IDs (`auth.uid()`).
- **Secure Workstation Persistence**: "Remember Workstation" tokens strictly isolate session state in local encrypted browser storage only upon deliberate opt-in, keeping credential fields blank by default.

### 2. Synchronous Anti-FOUC Guards

To prevent visual flashes of protected screens before authorization completes, synchronous gatekeeper scripts execute in the document `<head>` prior to DOM rendering:

- Verifies current session tokens synchronously.
- Intercepts unauthorized navigation and forces immediate redirection to the authentication gatekeeper.
- Decouples UI mounting from asynchronous network delays.

### 3. Non-Recursive Row Level Security (RLS)

Standard recursive profile queries can trigger PostgreSQL error `42P17`. IqwanEngine isolates role-checking functions by running them with administrative security definers while explicitly disabling internal RLS re-evaluation:

```sql
-- Secure role extraction without recursive policy loops
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'superadmin'
  );
$$;
```

This pattern guarantees that session permission evaluation remains deterministic, performant, and leak-proof.

---

## 📁 Directory Structure

```text
├── index.html                  # Institutional Login Portal & Gatekeeper
├── daftar.html                 # Public Client Registration Form
├── dashboard-admin.html        # Superadmin Command Center
├── dashboard-bdm.html          # Institutional BDM Partner Portal
├── supabase_schema.sql         # Production DDL, RLS Policies & Security Functions
├── package.json                # Engine Dependencies & Compilation Scripts
├── vite.config.ts              # Multi-Page Architecture (MPA) Build Config
├── .env.example                # Deployment Environment Blueprint
└── src/
    └── js/
        ├── app.js              # CRM Mutation Controller, State & Filters
        ├── auth.js             # RBAC Resolution & Navigation Guard Engine
        ├── supabase.js         # Supabase Client & Realtime Subscription Channels
        ├── ui.js               # Reactive Toast & UI Feedback System
        └── utils.js            # Formatters, WhatsApp Dispatcher & Sanitizers
```

---

## 🚀 Deployment & Environment Setup

### 1. Prerequisites

- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher
- **Supabase Instance**: Managed or Self-Hosted PostgreSQL 15+

### 2. Environment Configuration

Duplicate the example environment file:

```bash
cp .env.example .env
```

Populate `.env` with your project configuration:

```ini
# Core Supabase Connectivity
VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-public-anon-key>

# Application Runtime Profile
VITE_APP_ENV=production
VITE_PORT=3000
```

> [!NOTE]
> All sensitive administrative assignments and role delegations are managed directly within `public.profiles` using encrypted database claims. No administrative emails or secret tokens should ever be defined in client-accessible environment files.

### 3. Database Bootstrap

Open your **Supabase Dashboard** $\rightarrow$ **SQL Editor**, and execute [`supabase_schema.sql`](./supabase_schema.sql):

1. Provisions `public.clients` with indexed search parameters.
2. Initializes `public.system_settings` for dynamic preset management.
3. Configures `public.profiles` with hardened, non-recursive RLS policies.
4. Binds automated user synchronization triggers to `auth.users`.
5. Enables PostgreSQL Realtime replication streams for immediate UI updates.

### 4. Development & Build

```bash
# Install dependencies
npm install

# Run local development server
npm run dev

# Compile optimized multi-page production bundle
npm run build
```

Compiled production assets will be generated in the `dist/` directory.

---

## 📋 Operational Workflow (SOP)

| Phase  | Acting Role     | Action Description                                                    | System State Transition                                         |
| :----: | :-------------- | :-------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **01** | **Client**      | Submits registration via `daftar.html` with MT4/MT5 details.          | `Status: Pending` <br> `Action: -`                              |
| **02** | **Superadmin**  | Validates account criteria, applies remark tier, and dispatches lead. | `Status: Pending` <br> `Action: Submit to BDM`                  |
| **03** | **BDM Partner** | Filters pipeline for assigned submissions, inspects broker portal.    | `Status: In Review` <br> `Action: Reviewed`                     |
| **04** | **BDM Partner** | Completes broker rebate setup and issues final platform sign-off.     | `Status: Completed` <br> `Action: Action Taken` _(Timestamped)_ |

---

## 🛠️ Tech Stack

- **Runtime & Bundler**: [Vite](https://vitejs.dev/) (Multi-Page Architecture)
- **Frontend Logic**: Vanilla JavaScript (Modern ES Modules)
- **Styling Framework**: [Tailwind CSS v4](https://tailwindcss.com/) with Glassmorphism System
- **Database & Realtime**: [Supabase](https://supabase.com/) (PostgreSQL 15+, Auth Engine, Realtime Engine)
- **Interface Assets**: [Lucide Icons](https://lucide.dev/)

---

## 📄 License & Intellectual Property

Proprietary enterprise software developed exclusively for institutional partner operations. Unauthorized copying, distribution, or reverse engineering of this software is strictly prohibited.
