#!/usr/bin/env node --experimental-strip-types
// Concurrency check for the control lease: one active controller, N viewers.
//
// This exercises the store directly rather than through the HTTP API, because
// the interesting cases are about *time* — a lease expiring because a browser
// stopped heartbeating — and driving them through two real browser sessions
// would mean waiting on wall-clock for every assertion. The API routes on top
// are a thin shell over exactly these calls.
//
// Run: node --experimental-strip-types scripts/test-control-lease.mjs

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import {
  LEASE_TTL_MS,
  getControlStore,
} from "../src/lib/control/store.ts";

const LAB = "test-lab";
const ana = { id: "u-ana", name: "Ana" };
const beto = { id: "u-beto", name: "Beto" };
const caro = { id: "u-caro", name: "Caro" };

let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

const store = await getControlStore();
console.log(`control store backend: ${store.backend}\n`);

// Each scenario uses its own lab id so state never leaks between them.
const lab = (suffix) => `${LAB}-${suffix}`;

console.log("one active controller");

await check("the first to ask gets control", async () => {
  const id = lab("first");
  const result = await store.take(id, ana);
  assert.equal(result.granted, true);
  const state = await store.state(id);
  assert.equal(state.holder?.id, ana.id);
});

await check("a second operator is queued, not granted", async () => {
  const id = lab("queue");
  await store.take(id, ana);
  const result = await store.take(id, beto);
  assert.equal(result.granted, false);
  assert.ok(result.position >= 1);

  const state = await store.state(id);
  assert.equal(state.holder?.id, ana.id, "holder changed under a second taker");
  assert.deepEqual(
    state.queue.map((u) => u.id),
    [beto.id],
  );
});

await check("everyone can watch while one drives", async () => {
  const id = lab("viewers");
  await store.take(id, ana);
  for (const user of [ana, beto, caro]) await store.joinPresence(id, user);

  const state = await store.state(id);
  assert.equal(state.presence.length, 3, "spectators were not all registered");
  assert.equal(state.holder?.id, ana.id);
});

console.log("\nthe lease outlives nothing");

await check("a holder that stops heartbeating loses control", async () => {
  const id = lab("crash");
  await store.take(id, ana);
  assert.equal((await store.state(id)).holder?.id, ana.id);

  // Simulates the browser dying: no release, no heartbeat, just silence.
  await sleep(LEASE_TTL_MS + 400);

  const state = await store.state(id);
  assert.equal(state.holder, null, "a crashed controller kept the hardware");
});

await check("the next in line inherits it on their own heartbeat", async () => {
  const id = lab("inherit");
  await store.take(id, ana);
  await store.take(id, beto); // queued behind Ana

  await sleep(LEASE_TTL_MS + 400); // Ana's browser dies

  const promoted = await store.heartbeat(id, beto);
  assert.equal(promoted.granted, true, "the queued operator was not promoted");
  assert.equal((await store.state(id)).holder?.id, beto.id);
});

await check("heartbeats hold the lease indefinitely", async () => {
  const id = lab("heartbeat");
  await store.take(id, ana);
  for (let i = 0; i < 3; i++) {
    await sleep(LEASE_TTL_MS / 2);
    const beat = await store.heartbeat(id, ana);
    assert.equal(beat.granted, true, `lost the lease on beat ${i + 1}`);
  }
  assert.equal((await store.state(id)).holder?.id, ana.id);
});

await check("releasing hands over immediately", async () => {
  const id = lab("release");
  await store.take(id, ana);
  await store.take(id, beto);
  await store.release(id, ana.id);

  assert.equal((await store.state(id)).holder, null);
  const beat = await store.heartbeat(id, beto);
  assert.equal(beat.granted, true);
});

console.log("\nadmin override and emergency stop");

await check("force takes the lease from a live holder", async () => {
  const id = lab("force");
  await store.take(id, ana);
  const forced = await store.force(id, beto);

  assert.equal(forced.granted, true);
  assert.equal((await store.state(id)).holder?.id, beto.id);

  // The displaced holder must not silently get it back on their next beat.
  const anaBeat = await store.heartbeat(id, ana);
  assert.equal(anaBeat.granted, false, "the displaced holder reclaimed control");
});

await check("e-stop is recorded for everyone, from a non-holder", async () => {
  const id = lab("estop");
  await store.take(id, ana);

  // Beto holds nothing at all — that is the point.
  await store.estop(id, beto);

  const state = await store.state(id);
  assert.ok(state.estopAt, "the stop was not recorded");
  assert.equal(state.estopBy, beto.name);
  // Stopping does not steal control; it stops the hardware.
  assert.equal(state.holder?.id, ana.id);
});

console.log("\nspectator fan-out");

await check("every mutation reaches a subscriber", async () => {
  const id = lab("subscribe");
  const seen = [];
  const unsubscribe = await store.subscribe(id, (state) =>
    seen.push(state.holder?.id ?? null),
  );

  await store.take(id, ana);
  await store.release(id, ana.id);
  await sleep(150);
  unsubscribe();

  assert.ok(seen.includes(ana.id), "a spectator never saw the takeover");
  assert.ok(
    seen.lastIndexOf(null) > seen.indexOf(ana.id),
    "a spectator never saw the release",
  );
});

console.log(
  failures === 0
    ? "\nall control-lease checks passed"
    : `\n${failures} control-lease check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
