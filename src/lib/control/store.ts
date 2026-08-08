// Hardware control plane: one active controller per lab, everyone else
// spectates. The lease is a 15 s TTL entry extended by client heartbeats —
// a crashed or disconnected controller releases the hardware automatically.
// Redis is the production store (multi-instance + Pub/Sub fan-out); without
// REDIS_URL an in-memory store keeps a single instance fully functional.

import { EventEmitter } from "node:events";
import type { RedisClientType } from "redis";

export const LEASE_TTL_MS = 15_000;
export const QUEUE_TTL_MS = 30_000;
export const PRESENCE_TTL_MS = 60_000;

export interface ControlUser {
  id: string;
  name: string;
}

export interface ControlState {
  holder: ControlUser | null;
  queue: ControlUser[];
  presence: ControlUser[];
  /** Timestamp of the last emergency stop, if any. */
  estopAt: number | null;
  estopBy: string | null;
}

export interface TakeResult {
  granted: boolean;
  position: number; // 0 = holder, 1 = next in line…
}

interface Entry {
  user: ControlUser;
  joined: number;
  last: number;
}

interface StoreState {
  holder: { user: ControlUser; expires: number } | null;
  queue: Map<string, Entry>;
  presence: Map<string, Entry>;
  estopAt: number | null;
  estopBy: string | null;
}

// ── Core semantics (shared by both backends via a JSON state blob) ──────────

function prune(s: StoreState, now: number): void {
  if (s.holder && s.holder.expires <= now) s.holder = null;
  for (const [id, e] of s.queue) if (now - e.last > QUEUE_TTL_MS) s.queue.delete(id);
  for (const [id, e] of s.presence) if (now - e.last > PRESENCE_TTL_MS) s.presence.delete(id);
}

function orderedQueue(s: StoreState): Entry[] {
  return [...s.queue.values()].sort((a, b) => a.joined - b.joined);
}

function tryAcquire(s: StoreState, user: ControlUser, now: number): TakeResult {
  prune(s, now);
  if (!s.holder || s.holder.user.id === user.id) {
    // Free (or already ours): grant only if we are first in line or the
    // queue is empty / we head it.
    const q = orderedQueue(s).filter((e) => e.user.id !== user.id);
    if (!s.holder && q.length > 0 && q[0].joined < (s.queue.get(user.id)?.joined ?? now)) {
      // Someone queued before us — keep waiting.
      s.queue.set(user.id, {
        user,
        joined: s.queue.get(user.id)?.joined ?? now,
        last: now,
      });
      return { granted: false, position: position(s, user.id) };
    }
    s.holder = { user, expires: now + LEASE_TTL_MS };
    s.queue.delete(user.id);
    return { granted: true, position: 0 };
  }
  s.queue.set(user.id, {
    user,
    joined: s.queue.get(user.id)?.joined ?? now,
    last: now,
  });
  return { granted: false, position: position(s, user.id) };
}

// Admin override. The reference implementation called it "force control": an
// arm left enabled by someone who walked away blocks the lab until their lease
// expires, and a project admin needs a way through that is not "wait". The
// displaced holder finds out the same way everyone else does — the state
// stream — and their next heartbeat returns no lease token, so their commands
// stop being authorized within one heartbeat interval.
function forceAcquire(s: StoreState, user: ControlUser, now: number): TakeResult {
  prune(s, now);
  s.holder = { user, expires: now + LEASE_TTL_MS };
  s.queue.delete(user.id);
  return { granted: true, position: 0 };
}

function position(s: StoreState, userId: string): number {
  const q = orderedQueue(s);
  const idx = q.findIndex((e) => e.user.id === userId);
  return idx === -1 ? q.length + 1 : idx + 1;
}

function heartbeat(s: StoreState, user: ControlUser, now: number): TakeResult {
  prune(s, now);
  if (s.holder?.user.id === user.id) {
    s.holder.expires = now + LEASE_TTL_MS;
    return { granted: true, position: 0 };
  }
  if (s.queue.has(user.id)) {
    // Waiting: refresh, and take over if the lease is free and we head it.
    const e = s.queue.get(user.id)!;
    e.last = now;
    return tryAcquire(s, user, now);
  }
  return { granted: false, position: position(s, user.id) };
}

function release(s: StoreState, userId: string, now: number): boolean {
  prune(s, now);
  if (s.holder?.user.id === userId) {
    s.holder = null;
    return true;
  }
  s.queue.delete(userId);
  return false;
}

function touchPresence(s: StoreState, user: ControlUser, now: number): void {
  const e = s.presence.get(user.id);
  s.presence.set(user.id, { user, joined: e?.joined ?? now, last: now });
}

function publicState(s: StoreState, now: number): ControlState {
  prune(s, now);
  return {
    holder: s.holder?.user ?? null,
    queue: orderedQueue(s).map((e) => e.user),
    presence: [...s.presence.values()]
      .sort((a, b) => a.joined - b.joined)
      .map((e) => e.user),
    estopAt: s.estopAt,
    estopBy: s.estopBy,
  };
}

// ── Serialization for the Redis backend ─────────────────────────────────────

interface WireState {
  holder: { user: ControlUser; expires: number } | null;
  queue: Entry[];
  presence: Entry[];
  estopAt: number | null;
  estopBy: string | null;
}

function toWire(s: StoreState): WireState {
  return {
    holder: s.holder,
    queue: [...s.queue.values()],
    presence: [...s.presence.values()],
    estopAt: s.estopAt,
    estopBy: s.estopBy,
  };
}

function fromWire(w: WireState | null): StoreState {
  return {
    holder: w?.holder ?? null,
    queue: new Map((w?.queue ?? []).map((e) => [e.user.id, e])),
    presence: new Map((w?.presence ?? []).map((e) => [e.user.id, e])),
    estopAt: w?.estopAt ?? null,
    estopBy: w?.estopBy ?? null,
  };
}

// ── Store interface ─────────────────────────────────────────────────────────

export interface ControlStore {
  readonly backend: "redis" | "memory";
  take(labId: string, user: ControlUser): Promise<TakeResult>;
  /** Seize the lease regardless of who holds it. Admins only — see route. */
  force(labId: string, user: ControlUser): Promise<TakeResult>;
  heartbeat(labId: string, user: ControlUser): Promise<TakeResult>;
  release(labId: string, userId: string): Promise<void>;
  estop(labId: string, by: ControlUser): Promise<void>;
  joinPresence(labId: string, user: ControlUser): Promise<void>;
  leavePresence(labId: string, userId: string): Promise<void>;
  state(labId: string): Promise<ControlState>;
  subscribe(labId: string, fn: (s: ControlState) => void): Promise<() => void>;
}

// ── In-memory backend (single instance; dev and degraded mode) ──────────────

class MemoryStore implements ControlStore {
  readonly backend = "memory" as const;
  private labs = new Map<string, StoreState>();
  private bus = new EventEmitter();

  private lab(id: string): StoreState {
    let s = this.labs.get(id);
    if (!s) {
      s = fromWire(null);
      this.labs.set(id, s);
    }
    return s;
  }

  private emit(id: string): void {
    this.bus.emit(id, publicState(this.lab(id), Date.now()));
  }

  async take(id: string, user: ControlUser): Promise<TakeResult> {
    const r = tryAcquire(this.lab(id), user, Date.now());
    this.emit(id);
    return r;
  }
  async force(id: string, user: ControlUser): Promise<TakeResult> {
    const r = forceAcquire(this.lab(id), user, Date.now());
    this.emit(id);
    return r;
  }
  async heartbeat(id: string, user: ControlUser): Promise<TakeResult> {
    const before = publicState(this.lab(id), Date.now()).holder?.id ?? null;
    const r = heartbeat(this.lab(id), user, Date.now());
    if ((this.lab(id).holder?.user.id ?? null) !== before) this.emit(id);
    return r;
  }
  async release(id: string, userId: string): Promise<void> {
    release(this.lab(id), userId, Date.now());
    this.emit(id);
  }
  async estop(id: string, by: ControlUser): Promise<void> {
    const s = this.lab(id);
    s.estopAt = Date.now();
    s.estopBy = by.name;
    this.emit(id);
  }
  async joinPresence(id: string, user: ControlUser): Promise<void> {
    touchPresence(this.lab(id), user, Date.now());
    this.emit(id);
  }
  async leavePresence(id: string, userId: string): Promise<void> {
    this.lab(id).presence.delete(userId);
    this.emit(id);
  }
  async state(id: string): Promise<ControlState> {
    return publicState(this.lab(id), Date.now());
  }
  async subscribe(id: string, fn: (s: ControlState) => void): Promise<() => void> {
    this.bus.on(id, fn);
    return () => this.bus.off(id, fn);
  }
}

// ── Redis backend ───────────────────────────────────────────────────────────
// State lives in one key per lab, mutated under a short WATCH-free lock via
// Lua-less optimistic writes: mutations are serialized through a per-lab
// Redis lock key (SET NX PX 2000) to keep read-modify-write atomic enough
// for this small state, and every mutation publishes the new public state.

class RedisStore implements ControlStore {
  readonly backend = "redis" as const;

  constructor(
    private client: RedisClientType,
    private subClient: RedisClientType,
  ) {}

  private key(id: string): string {
    return `lab:${id}:control`;
  }
  private chan(id: string): string {
    return `lab:${id}:events`;
  }

  private async mutate<T>(
    id: string,
    fn: (s: StoreState, now: number) => T,
  ): Promise<T> {
    const lockKey = `lab:${id}:mutex`;
    // Spin briefly for the mutation mutex; contention here is tiny.
    for (let i = 0; i < 50; i++) {
      const ok = await this.client.set(lockKey, "1", { NX: true, PX: 2000 });
      if (ok) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    try {
      const now = Date.now();
      const raw = await this.client.get(this.key(id));
      const s = fromWire(raw ? (JSON.parse(raw) as WireState) : null);
      const result = fn(s, now);
      await this.client.set(this.key(id), JSON.stringify(toWire(s)), {
        PX: 24 * 3600 * 1000,
      });
      await this.client.publish(
        this.chan(id),
        JSON.stringify(publicState(s, now)),
      );
      return result;
    } finally {
      await this.client.del(lockKey);
    }
  }

  take(id: string, user: ControlUser): Promise<TakeResult> {
    return this.mutate(id, (s, now) => tryAcquire(s, user, now));
  }
  force(id: string, user: ControlUser): Promise<TakeResult> {
    return this.mutate(id, (s, now) => forceAcquire(s, user, now));
  }
  heartbeat(id: string, user: ControlUser): Promise<TakeResult> {
    return this.mutate(id, (s, now) => heartbeat(s, user, now));
  }
  async release(id: string, userId: string): Promise<void> {
    await this.mutate(id, (s, now) => release(s, userId, now));
  }
  async estop(id: string, by: ControlUser): Promise<void> {
    await this.mutate(id, (s) => {
      s.estopAt = Date.now();
      s.estopBy = by.name;
    });
  }
  async joinPresence(id: string, user: ControlUser): Promise<void> {
    await this.mutate(id, (s, now) => touchPresence(s, user, now));
  }
  async leavePresence(id: string, userId: string): Promise<void> {
    await this.mutate(id, (s) => s.presence.delete(userId));
  }
  async state(id: string): Promise<ControlState> {
    const raw = await this.client.get(this.key(id));
    return publicState(
      fromWire(raw ? (JSON.parse(raw) as WireState) : null),
      Date.now(),
    );
  }
  async subscribe(
    id: string,
    fn: (s: ControlState) => void,
  ): Promise<() => void> {
    const handler = (message: string) => {
      try {
        fn(JSON.parse(message) as ControlState);
      } catch {
        // Malformed event: skip.
      }
    };
    await this.subClient.subscribe(this.chan(id), handler);
    return () => {
      void this.subClient.unsubscribe(this.chan(id), handler);
    };
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __controlStore: Promise<ControlStore> | undefined;
}

async function build(): Promise<ControlStore> {
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const { createClient } = await import("redis");
      const client = createClient({ url }) as RedisClientType;
      const subClient = client.duplicate() as RedisClientType;
      await client.connect();
      await subClient.connect();
      return new RedisStore(client, subClient);
    } catch (e) {
      console.warn(
        `control store: Redis unavailable (${(e as Error).message}); using in-memory store`,
      );
    }
  }
  return new MemoryStore();
}

export function getControlStore(): Promise<ControlStore> {
  // Survives dev hot reloads; one store per server process.
  globalThis.__controlStore ??= build();
  return globalThis.__controlStore;
}
