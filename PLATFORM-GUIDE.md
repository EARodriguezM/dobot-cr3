# PRIMBIO Platform Guide — the shared contract

> **Version: 2026-08.3** (bump on every edit).
> **Canonical copy:** the hub repository (`hub/PLATFORM-GUIDE.md`). Every lab
> repository carries an identical copy at its root. Changes are made in the hub
> repo first and copied verbatim to every lab repo in the same change — a lab
> holding a stale copy is a bug even if the lab still works.

PRIMBIO is a modular set of web apps: **one central hub plus N independent
remote-lab apps**, all sharing one identity, one database, and one design
system. This document is the contract that keeps them from diverging. Anything
under **Shared** may not be changed by a lab team on its own — propose the
change against the hub repo. Anything under **Lab-owned** is yours to shape
freely.

---

## 1. The two app types

### Type 1 — the hub (`https://primbiolab.org`)

Public presentation of the seedbed (description, research lines, research
path, projects, members, labs directory with live status) + the central
Google sign-in + the authenticated dashboard and admin area for every remote
lab. The hub owns the database schema and the auth contract for the whole
platform.

### Type 2 — a remote lab (`https://<slug>.primbiolab.org`)

The web interface a team builds for its hardware, always started by forking
the **lab template** repository. A lab app is deployed as two
Cloudflare-managed hostnames:

```text
user ──► <slug>.primbiolab.org            UI — always live, robot or not
              │  fetch /api/*, WebSocket /ws/*
              ▼
         <slug>-control.primbiolab.org    Cloudflare Tunnel → lab computer
              ▼                           (Raspberry Pi: ROS 2 + bridges)
        foxglove_bridge :8765 · go2rtc :1984 · hardware driver
```

**Naming rule (TLS):** free Universal SSL covers only one wildcard level, so
the control hostname is `<slug>-control.primbiolab.org` — never
`control.<slug>.primbiolab.org`.

---

## 2. Shared — MUST stay identical across all apps

### 2.1 Authentication (one Supabase project for everything)

- **One central Supabase project** (the hub's). Labs never create their own.
- **Google OAuth only**, restricted to `@unal.edu.co`. The primary gate is a
  `BEFORE INSERT` trigger on `auth.users` checking the
  `public.allowed_email_domains` table; app-layer checks are defense in
  depth, never the only gate.
- Session cookies carry `Domain=.primbiolab.org` in production
  (env `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN`, unset in local dev) so one hub
  sign-in is valid on every lab, and sign-out is global. Public prefix on
  purpose: the browser client writes auth cookies too and must use the same
  scope.
- **Sessions live in cookies, never localStorage** — use `@supabase/ssr`
  clients everywhere. localStorage is per-origin and silently breaks
  cross-subdomain SSO.
- Every lab origin must be added to the Supabase auth redirect allowlist.
- Lab backends verify the Supabase **access token** server-side and read
  roles from the JWT claims (injected by the auth hook). The service-role
  key exists server-side only and is never shipped to a browser.

### 2.2 Database schema (owned by the hub repo)

All schema lives in `hub/supabase/migrations/` — sequential, append-only,
**labs never run migrations**. Core tables every app relies on:

- `profiles` — mirror of `auth.users`, provisioned by a trigger on signup
  (migration 0013). No app creates it: a callback writing it from the browser
  session lands as `anon` and fails silently. Apps may refresh their own row.
- `projects` — metadata, status, `owner_id` (exactly one owner per project).
- `project_members` — `(project_id, user_id, role)`,
  `role ∈ owner | admin | operator | viewer`; dynamic number of admins.
  Only *elevation* is stored here: since migration 0012 every authenticated
  account is an implicit **viewer** of every project, so an absent row means
  viewer, not "no access". Edge services must default to the same (the
  gatekeeper's `LAB_DEFAULT_ROLE`), or a lab will admit someone in its UI and
  reject them at the socket.
- `remote_labs` — hardware endpoints + tunnel config, FK → `projects`.

**RLS is the authorization gate** in every app; UI checks are cosmetic. A
project's owner and admins manage that project's roles — from the hub and
from the lab's own admin UI. Never bypass a policy with the service-role key.

### 2.3 Concurrency model (every lab implements it)

- **N concurrent viewers, one active controller.** Control is a Redis lease:
  `SET NX` with a 15 s TTL, extended by client heartbeats. Crash or
  disconnect ⇒ lease expires ⇒ next user in the queue takes control.
- Spectators are fed via Redis Pub/Sub: the edge device publishes telemetry
  **once**, the server fans it out.
- A presence list shows who is connected and who is driving.
- **Emergency stop never requires the lease** — any operator can stop the
  hardware at any time. Do not "fix" this.

### 2.4 Lab status heartbeat

A lab reports itself: it beats directly to Supabase (never through the hub
app) every ~30 s, best-effort, failures swallowed. Silent for 90 s ⇒ shown
offline everywhere. Status is computed from `last_seen_at`, never hand-typed.

Mechanism (2026-08.2): the lab computer calls the `lab_heartbeat(slug,
secret)` RPC with the **anon key** plus a per-lab secret. Secrets are set or
rotated by the project's owner/admins via `set_lab_heartbeat_secret(lab_id,
secret)` (min 16 chars; only a SHA-256 hash is stored, in a table with no API
grants). `last_seen_at` has no update grant — the RPC is the only write path.
The template ships the sender (`scripts/heartbeat.mjs`, also started by the
app itself when `LAB_HEARTBEAT_SECRET` is set).

### 2.5 WebSocket authentication

The `/ws/*` tunnel path is bypassed in Cloudflare Access (browsers cannot
follow the interactive 302). Security moves to the application layer: the
client sends its Supabase JWT in the first WebSocket payload; the edge
security node verifies signature + role before accepting, and closes the
socket immediately on failure. The hardware never listens on a public port —
only the outbound tunnel reaches it.

### 2.6 Design system

Shared tokens live in each app's `src/app/globals.css` (copied from the lab
template / hub — keep them identical). Warm paper/ink palette, terracotta
accent `#c8420a` (light) / `#e0571c` (dark); fonts Syne (headings),
IBM Plex Mono (technical labels), Lora (body). Light default, dark via
`[data-theme="dark"]` on `<html>`. Inverted "ink bands" stay dark in both
themes. Mobile-first is a requirement: off-canvas navigation, stacking teleop
layout, `100dvh`, `prefers-reduced-motion`, visible focus outlines.
UI copy is Spanish; code, comments and docs are English.

---

## 3. Lab-owned — free to shape per lab

- All hardware-specific UI: control panels, visualizations, 3D views.
- The ROS 2 workspace: drivers, bringup, message definitions.
- Camera sources and layouts (behind the shared go2rtc pipeline).
- Extra pages, docs and tooling local to the lab.
- The lab's own operator/viewer role assignments (within the shared schema).

---

## 4. Environment variables (common names)

| Variable | Where | Meaning |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | both | central Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | both | public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | never in a browser bundle |
| `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` | both, prod only | `.primbiolab.org`; unset in dev |
| `REDIS_URL` | lab server | control lease + pub/sub |

Every app must build and boot with all of these unset (public pages work,
protected routes bounce to login, lab UI goes view-only).

---

## 5. Change management

1. Edit this file in the hub repo, bump the version header.
2. Copy it verbatim to every lab repo in the same change.
3. Schema, roles and auth flow change in the hub repo **only**.
