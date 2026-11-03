import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEventSchedule } from "../event-calendar.mjs";
import { createDatabase } from "../database.mjs";
import { startTestServer } from "./test-server.mjs";

test("events expire at their confirmed end, not their start or first calendar day", () => {
  assert.deepEqual(getEventSchedule({ startsAt: "2026-11-01T18:30:00-05:00", endsAt: "2026-11-03T20:00:00-05:00" }), {
    sortAt: "2026-11-01T23:30:00.000Z", expiresAt: "2026-11-04T01:00:00.000Z",
  });
  assert.equal(getEventSchedule({ startsAt: "2026-11-01T18:30:00-05:00" }).expiresAt, "2026-11-02T05:00:00.000Z");
});

test("date-only expiration honors event time zones and daylight-saving boundaries", () => {
  for (const [dateLabel, timeZone, expected] of [
    ["Mar 8, 2026", "America/New_York", "2026-03-09T04:00:00.000Z"],
    ["November 1st, 2026", "America/New_York", "2026-11-02T05:00:00.000Z"],
    ["2026-11-01", "America/Los_Angeles", "2026-11-02T08:00:00.000Z"],
    ["11/1/2026", "Asia/Tokyo", "2026-11-01T15:00:00.000Z"],
    ["Nov 1, 2026", "Invalid/Zone", "2026-11-02T05:00:00.000Z"],
  ]) assert.equal(getEventSchedule({ dateLabel, timeZone }).expiresAt, expected);
});

test("yearless dates use a stable creation anchor and never become recurring yearly events", () => {
  assert.equal(getEventSchedule({ dateLabel: "Jan 2", createdAt: "2026-12-20T12:00:00Z" }).expiresAt, "2027-01-03T05:00:00.000Z");
  assert.equal(getEventSchedule({ dateLabel: "Oct 30", createdAt: "2026-06-01T12:00:00Z" }).expiresAt, "2026-10-31T04:00:00.000Z");
  assert.equal(getEventSchedule({ dateLabel: "Oct 30, 2025", createdAt: "2026-06-01T12:00:00Z" }).expiresAt, "2025-10-31T04:00:00.000Z");
});

test("unknown and invalid dates stay visible instead of guessing an expiration", () => {
  for (const dateLabel of ["Date TBD", "Soon", "Oct 30", "Feb 30, 2026", "2026-02-29", "13/30/2026", "Nov 1-3, 2026"]) {
    assert.deepEqual(getEventSchedule({ dateLabel }), { sortAt: null, expiresAt: null });
  }
});

function databaseFor(mode, rootDir, events) {
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = mode === "supabase" ? "https://database.example" : "";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  try { return createDatabase({ rootDir, seedDatabase: { members: [], events, requests: [] } }); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

for (const mode of ["local-json", "supabase"]) {
  test(`${mode} hides expired and unpublished events only from member listings`, async (t) => {
    const rootDir = await mkdtemp(join(tmpdir(), "vip-event-expiry-"));
    const now = Date.parse("2026-11-01T22:00:00Z");
    t.mock.method(Date, "now", () => now);
    const events = [
      { id: "ended", endsAt: new Date(now).toISOString() },
      { id: "ongoing", startsAt: "2026-10-30T20:00:00Z", endsAt: "2026-11-02T01:00:00Z" },
      { id: "today", dateLabel: "Nov 1, 2026" },
      { id: "past-yearless", dateLabel: "Oct 30", createdAt: "2026-06-01T12:00:00Z" },
      { id: "tbd", dateLabel: "Date TBD" },
      { id: "hidden", endsAt: "2026-12-01T01:00:00Z", visible: false },
    ];
    const db = databaseFor(mode, rootDir, events);
    if (mode === "supabase") t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(events.map((event) => ({
      id: event.id, starts_at: event.startsAt, ends_at: event.endsAt, date_label: event.dateLabel,
      created_at: event.createdAt, visible: event.visible !== false,
    })))));
    try {
      await db.ensureDatabase();
      const listed = await db.listEvents({ visibleOnly: true });
      assert.deepEqual(listed.map((event) => event.id), ["ongoing", "today", "tbd"]);
      assert.equal(listed[1].expiresAt, "2026-11-02T05:00:00.000Z");
      assert.equal((await db.listEvents()).length, events.length);
    } finally { await rm(rootDir, { recursive: true, force: true }); }
  });
}

test("API removes events as time passes, retains admin history, and supports rescheduling", async () => {
  const server = await startTestServer({ mockClock: true });
  const setTime = (iso) => writeFile(join(server.directory, "clock-offset"), String(Date.parse(iso) - Date.now()));
  let cookie;
  const request = (path, method = "GET", body) => fetch(server.origin + path, {
    method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await setTime("2026-11-01T22:00:00Z");
    const login = await request("/api/admin/login", "POST", { password: "local-feature-test" });
    cookie = login.headers.get("set-cookie").split(";")[0];
    const create = async (body) => {
      const response = await request("/api/admin/events", "POST", body);
      assert.equal(response.status, 201);
      return (await response.json()).event;
    };
    const timed = await create({ title: "Timed", startsAt: "2026-11-01T23:00:00Z", endsAt: "2026-11-02T01:00:00Z" });
    const today = await create({ title: "Date only", dateLabel: "Nov 1, 2026" });
    const unknown = await create({ title: "TBD", dateLabel: "Date TBD" });
    const listedIds = async () => (await request("/api/events").then((r) => r.json())).events.map((event) => event.id);
    assert.deepEqual(new Set(await listedIds()), new Set([timed.id, today.id, unknown.id]));
    assert.equal((await request(`/api/events/${timed.id}/calendar.ics`)).status, 200);
    await setTime("2026-11-02T01:00:01Z");
    assert.deepEqual(new Set(await listedIds()), new Set([today.id, unknown.id]));
    assert.equal((await request(`/api/events/${timed.id}/calendar.ics`)).status, 404);
    await setTime("2026-11-02T05:00:01Z");
    assert.deepEqual(await listedIds(), [unknown.id]);
    const history = (await request("/api/admin/events").then((r) => r.json())).events;
    assert.ok(history.some((event) => event.id === timed.id));
    assert.ok(history.some((event) => event.id === today.id));
    assert.ok(history.find((event) => event.id === today.id).createdAt);
    const updated = await request(`/api/admin/events/${timed.id}`, "PATCH", {
      startsAt: "2026-11-03T23:00:00Z", endsAt: "2026-11-04T01:00:00Z",
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(new Set(await listedIds()), new Set([timed.id, unknown.id]));
  } finally { await server.close(); }
});
