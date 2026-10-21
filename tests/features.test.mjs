import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../database.mjs";
import { buildEventCalendar } from "../event-calendar.mjs";
import { startTestServer, signInMember } from "./test-server.mjs";

test("calendar keeps exact UTC dates, escapes text, and folds Unicode safely", () => {
  const calendar = buildEventCalendar({ id: "event-one", title: "VIP; Dinner, Night", copy: "First line\n" + "Caf\u00e9 ".repeat(40),
    location: "Venue", address: "123 Main St", startsAt: "2026-11-01T18:30:00-05:00", endsAt: "2026-11-01T20:00:00-05:00" });
  assert.match(calendar, /DTSTART:20261101T233000Z/);
  assert.match(calendar, /DTEND:20261102T010000Z/);
  assert.ok(calendar.includes("SUMMARY:VIP\\; Dinner\\, Night"));
  const unfolded = calendar.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("DESCRIPTION:First line\\n" + "Caf\u00e9 ".repeat(40)));
  for (const line of calendar.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  assert.throws(() => buildEventCalendar({ startsAt: "2026-11-01T18:00:00Z", endsAt: null }));
  assert.throws(() => buildEventCalendar({ startsAt: "2026-11-01T18:00:00Z", endsAt: "2026-11-01T17:00:00Z" }));
});

test("inbox isolates targeted notices and remembers read state per member", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vip-inbox-test-"));
  const previousUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "";
  const db = createDatabase({ rootDir, seedDatabase: { members: [], events: [], requests: [] } });
  if (previousUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousUrl;
  try {
    await db.ensureDatabase();
    await db.createNotification({ id: "public", title: "All members", memberId: null, createdAt: "2026-10-15T12:00:00Z" });
    await db.createNotification({ id: "private", title: "One member", memberId: "member-a", createdAt: "2026-10-15T13:00:00Z" });
    assert.deepEqual((await db.listNotifications("member-a")).map((n) => n.id), ["private", "public"]);
    assert.deepEqual((await db.listNotifications("member-b")).map((n) => n.id), ["public"]);
    await db.markNotificationsRead("member-a", ["private", "public"]);
    assert.ok((await db.listNotifications("member-a")).every((n) => n.readAt));
    assert.equal((await db.listNotifications("member-b"))[0].readAt, null);
    await db.markNotificationsRead("member-a", ["private"]);
    assert.equal((await db.listNotifications("member-a")).length, 2);
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test("Supabase inbox scopes embedded read receipts and safely quotes member IDs", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const db = createDatabase({ rootDir: tmpdir(), seedDatabase: {} });
  if (previousUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = previousKey;
  const memberId = 'member-a,("quoted")';
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response(JSON.stringify([{ id: "notice", title: "Hello", body: "Members", member_id: null,
      action_view: "events", created_at: "2026-10-15T12:00:00Z", vip_notification_reads: [{ read_at: "2026-10-15T13:00:00Z" }] }]));
  });
  const notices = await db.listNotifications(memberId);
  assert.equal(notices[0].readAt, "2026-10-15T13:00:00Z");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("select"), "*,vip_notification_reads(read_at)");
  assert.equal(calls[0].url.searchParams.get("or"), '(member_id.is.null,member_id.eq."member-a,(\\"quoted\\")")');
  assert.equal(calls[0].url.searchParams.get("vip_notification_reads.member_id"), 'eq."member-a,(\\"quoted\\")"');
});

test("API publishes without APNs, authenticates inbox access, persists reads and edits events", async () => {
  const server = await startTestServer();
  const request = (path, { method = "GET", body, token, cookie } = {}) => fetch(server.origin + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    assert.equal((await request("/api/notifications")).status, 401);
    assert.equal((await request("/api/admin/push/broadcast", { method: "POST", body: {} })).status, 401);
    const admin = await request("/api/admin/login", { method: "POST", body: { password: "local-feature-test" } });
    const cookie = admin.headers.get("set-cookie").split(";")[0];
    const notice = await request("/api/admin/push/broadcast", { method: "POST", cookie, body: { title: "Member news", message: "Dinner is coming", actionView: "perks" } });
    assert.equal(notice.status, 200);
    const published = await notice.json();
    assert.ok(published.notificationId);
    assert.equal(published.summary.sent, 0);
    const member = await signInMember(server.origin);
    const token = member.sessionToken;
    assert.ok(token);
    const notices = await request("/api/notifications", { token }).then((r) => r.json());
    assert.equal(notices.notifications[0].title, "Member news");
    assert.equal(notices.notifications[0].readAt, null);
    assert.equal(notices.notifications[0].actionView, "perks");
    assert.equal((await request("/api/notifications/not-owned/read", { method: "PATCH", token })).status, 404);
    assert.equal((await request(`/api/notifications/${published.notificationId}/read`, { method: "PATCH", token })).status, 200);
    assert.ok((await request("/api/notifications", { token }).then((r) => r.json())).notifications[0].readAt);
    const other = await signInMember(server.origin, "jordan@example.com", "Rivera");
    assert.equal((await request("/api/notifications", { token: other.sessionToken }).then((r) => r.json())).notifications[0].readAt, null);
    await request("/api/notifications/read-all", { method: "POST", token: other.sessionToken });
    assert.ok((await request("/api/notifications", { token: other.sessionToken }).then((r) => r.json())).notifications[0].readAt);
    const event = { title: "VIP Dinner", startsAt: "2026-11-01T23:30:00Z", endsAt: "2026-11-02T01:00:00Z", timeZone: "America/New_York", image: "https://example.com/photo.jpg", address: "123 Main St", location: "The Venue" };
    const created = await request("/api/admin/events", { method: "POST", cookie, body: event });
    assert.equal(created.status, 201);
    const saved = (await created.json()).event;
    assert.equal(saved.timeLabel, "6:30 PM EST");
    const calendar = await request(`/api/events/${saved.id}/calendar.ics`);
    assert.match(calendar.headers.get("content-type"), /text\/calendar/);
    assert.match(await calendar.text(), /DTSTART:20261101T233000Z/);
    const edited = await request(`/api/admin/events/${saved.id}`, { method: "PATCH", cookie, body: { title: "Updated Dinner", visible: false } });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).event.title, "Updated Dinner");
    assert.equal((await request(`/api/events/${saved.id}/calendar.ics`)).status, 404);
    assert.equal((await request("/api/admin/events", { method: "POST", cookie, body: { ...event, endsAt: event.startsAt } })).status, 400);
    assert.equal((await request("/api/admin/events", { method: "POST", cookie, body: { ...event, image: "javascript:alert(1)" } })).status, 400);
  } finally { await server.close(); }
});

test("feedback saves sanitized build details for email and admin without changing other help requests", async () => {
  const server = await startTestServer();
  try {
    const member = await signInMember(server.origin);
    const send = (body, token = member.sessionToken) => fetch(`${server.origin}/api/requests`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    const body = { type: "App feedback / bug report", phone: "4075550188", message: "The event link won't open.",
      appInfo: { version: "1.0\nInjected", build: "7", platform: "ios", osVersion: "26.6", deviceId: "must-not-be-included" } };
    assert.equal((await send(body, "invalid")).status, 401);
    assert.equal((await send({ ...body, message: "" })).status, 400);
    const response = await send(body);
    // The isolated server has no email credentials, but still persists the request for the VIP desk.
    assert.equal(response.status, 502);
    const feedback = (await response.json()).request;
    assert.equal(feedback.message, "The event link won't open.\n\nApp details\nVersion: 1.0 Injected\nBuild: 7\nPlatform: ios\nOS version: 26.6");
    const ordinary = await send({ ...body, type: "Other" }).then((r) => r.json());
    assert.equal(ordinary.request.message, body.message);
    const legacy = await send({ ...body, appInfo: null }).then((r) => r.json());
    assert.match(legacy.request.message, /Build: Not available/);
    const login = await fetch(`${server.origin}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "local-feature-test" }) });
    const requests = await fetch(`${server.origin}/api/admin/requests`, { headers: { Cookie: login.headers.get("set-cookie").split(";")[0] } }).then((r) => r.json());
    assert.equal(requests.requests.find((request) => request.id === feedback.id).message, feedback.message);
  } finally { await server.close(); }
});
