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
      action_view: "events", created_at: "2026-10-15T12:00:00Z", vip_notification_reads: [{ member_id: memberId, read_at: "2026-10-15T13:00:00Z", deleted_at: null }] }]));
  });
  const notices = await db.listNotifications(memberId);
  assert.equal(notices[0].readAt, "2026-10-15T13:00:00Z");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("select"), "*,vip_notification_reads(member_id,read_at,deleted_at)");
  assert.equal(calls[0].url.searchParams.get("or"), '(member_id.is.null,member_id.eq."member-a,(\\"quoted\\")")');
  assert.equal(calls[0].url.searchParams.get("vip_notification_reads.member_id"), 'eq."member-a,(\\"quoted\\")"');
  assert.equal(calls[0].url.searchParams.get("order"), "created_at.desc,id.desc");
  assert.equal(calls[0].url.searchParams.get("offset"), "0");
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

test("only admins can rename VIPs; names persist, existing sessions work, and card names are optional", async () => {
  const server = await startTestServer();
  const request = (path, { method = "GET", body, token, cookie } = {}) => fetch(server.origin + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const session = await signInMember(server.origin);
    const original = session.member;
    const path = `/api/admin/members/${encodeURIComponent(original.id)}`;
    const body = { firstName: "  Avery   Anne ", lastName: " de la Cruz ", updateCardName: true,
      email: "should-not-change@example.com", status: "Paused", id: "different-id" };
    assert.equal((await request(path, { method: "PATCH", body })).status, 401);
    assert.equal((await request(path, { method: "PATCH", body, token: session.sessionToken })).status, 401);
    const login = await request("/api/admin/login", { method: "POST", body: { password: "local-feature-test" } });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    for (const invalid of [{ firstName: "", lastName: "Smith" }, { firstName: "Avery", lastName: " " },
      { firstName: {}, lastName: "Smith" }, { firstName: "A".repeat(101), lastName: "Smith" }]) {
      assert.equal((await request(path, { method: "PATCH", cookie, body: invalid })).status, 400);
    }
    assert.equal((await request("/api/admin/members/missing", { method: "PATCH", cookie, body })).status, 404);
    const edited = await request(path, { method: "PATCH", cookie, body });
    assert.equal(edited.status, 200);
    const member = (await edited.json()).member;
    assert.equal(member.name, "Avery Anne de la Cruz");
    assert.equal(member.firstName, "Avery Anne");
    assert.equal(member.lastName, "de la Cruz");
    assert.equal(member.cardName, member.name);
    for (const field of ["id", "email", "phone", "status", "memberId", "claimedAt"]) assert.equal(member[field], original[field]);
    const me = await request("/api/me", { token: session.sessionToken }).then((r) => r.json());
    assert.equal(me.member.name, member.name);
    const listed = await request("/api/admin/members", { cookie }).then((r) => r.json());
    assert.equal(listed.members.find((item) => item.id === original.id).name, member.name);
    assert.equal((await request("/api/claim/start", { method: "POST", body: { identity: original.email, lastName: "Mitchell" } })).status, 404);
    assert.equal((await request("/api/claim/start", { method: "POST", body: { identity: original.email, lastName: "de la Cruz" } })).status, 200);
    const keptCard = await request(path, { method: "PATCH", cookie, body: { firstName: "Avery", lastName: "O'Neil-Smith", updateCardName: false } }).then((r) => r.json());
    assert.equal(keptCard.member.name, "Avery O'Neil-Smith");
    assert.equal(keptCard.member.cardName, member.cardName);
  } finally { await server.close(); }
});

test("Supabase name edits patch all name columns without unrelated member changes", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const db = createDatabase({ rootDir: tmpdir(), seedDatabase: {} });
  if (previousUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = previousKey;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: new URL(url), options, body });
    return new Response(JSON.stringify([{ id: "member-a", ...body, card_name: body.card_name || "Custom Card Name" }]));
  });
  const patch = { firstName: "Ren\u00e9e", lastName: "de la Cruz", name: "Ren\u00e9e de la Cruz" };
  const kept = await db.updateMember("member-a", patch);
  assert.equal(kept.name, patch.name);
  assert.equal(kept.cardName, "Custom Card Name");
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].url.searchParams.get("id"), "eq.member-a");
  assert.deepEqual(calls[0].body, { first_name: patch.firstName, last_name: patch.lastName, name: patch.name });
  await db.updateMember("member-a", { ...patch, cardName: patch.name });
  assert.equal(calls[1].body.card_name, patch.name);
});

test("announcements can omit buttons while existing linked messages keep their destinations", async () => {
  const server = await startTestServer();
  try {
    const login = await fetch(`${server.origin}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "local-feature-test" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const expected = new Map();
    for (const actionView of ["events", "perks", "card", "concierge", "none", undefined, null, "unsupported"]) {
      const response = await fetch(`${server.origin}/api/admin/push/broadcast`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ title: "Member update", message: "A general VIP announcement.", actionView }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      expected.set(result.notificationId, ["events", "perks", "card", "concierge"].includes(actionView) ? actionView : "none");
    }
    const member = await signInMember(server.origin);
    const headers = { Authorization: `Bearer ${member.sessionToken}` };
    const inbox = await fetch(`${server.origin}/api/notifications`, { headers }).then((r) => r.json());
    assert.equal(inbox.notifications.length, expected.size);
    for (const notice of inbox.notifications) assert.equal(notice.actionView, expected.get(notice.id));
    const plain = inbox.notifications.find((notice) => notice.actionView === "none");
    const read = await fetch(`${server.origin}/api/notifications/${plain.id}/read`, { method: "PATCH", headers });
    assert.equal(read.status, 200);
    const updated = await fetch(`${server.origin}/api/notifications`, { headers }).then((r) => r.json());
    assert.ok(updated.notifications.find((notice) => notice.id === plain.id).readAt);
    for (const notice of updated.notifications) assert.equal(notice.actionView, expected.get(notice.id));
  } finally { await server.close(); }
});

test("Supabase preserves the no-button destination when storing and loading announcements", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const db = createDatabase({ rootDir: tmpdir(), seedDatabase: {} });
  if (previousUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = previousKey;
  let stored;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (options.method === "POST") {
      stored = JSON.parse(options.body);
      return new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify([{ ...stored, vip_notification_reads: [] }]));
  });
  await db.createNotification({ id: "plain-message", title: "Member news", body: "General update", actionView: "none", createdAt: "2026-10-22T18:00:00Z" });
  assert.equal(stored.action_view, "none");
  const notices = await db.listNotifications("member-a");
  assert.equal(notices[0].actionView, "none");
  assert.equal(notices[0].body, "General update");
});

test("notification deletion is private, idempotent, persistent, and rejects other members' messages", async () => {
  const server = await startTestServer();
  const request = (path, { method = "GET", token, cookie, body } = {}) => fetch(server.origin + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const a = await signInMember(server.origin);
    const b = await signInMember(server.origin, "jordan@example.com", "Rivera");
    const login = await request("/api/admin/login", { method: "POST", body: { password: "local-feature-test" } });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const published = await request("/api/admin/push/broadcast", { method: "POST", cookie, body: { title: "Old update", message: "Member news", actionView: "none" } }).then((r) => r.json());
    const path = `/api/notifications/${published.notificationId}`;
    assert.equal((await request(path, { method: "DELETE" })).status, 401);
    assert.equal((await request("/api/notifications/missing", { method: "DELETE", token: a.sessionToken })).status, 404);
    assert.equal((await request(path, { method: "DELETE", token: a.sessionToken, body: { memberId: b.member.id } })).status, 200);
    assert.equal((await request(path, { method: "DELETE", token: a.sessionToken })).status, 200);
    assert.deepEqual((await request("/api/notifications", { token: a.sessionToken }).then((r) => r.json())).notifications, []);
    const bInbox = await request("/api/notifications", { token: b.sessionToken }).then((r) => r.json());
    assert.equal(bInbox.notifications[0].id, published.notificationId);
    assert.equal(bInbox.notifications[0].readAt, null);
    await request("/api/notifications/read-all", { method: "POST", token: a.sessionToken });
    assert.equal((await request(`${path}/read`, { method: "PATCH", token: a.sessionToken })).status, 404);
    const again = await signInMember(server.origin);
    assert.deepEqual((await request("/api/notifications", { token: again.sessionToken }).then((r) => r.json())).notifications, []);
    const previousUrl = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "";
    const db = createDatabase({ rootDir: server.directory, seedDatabase: { members: [], events: [], requests: [] } });
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    await db.createNotification({ id: "b-only", title: "Private notice", body: "For Jordan", memberId: b.member.id, createdAt: new Date().toISOString() });
    assert.equal((await request("/api/notifications/b-only", { method: "DELETE", token: a.sessionToken })).status, 404);
    assert.ok((await db.listNotifications(b.member.id)).some((item) => item.id === "b-only"));
    assert.equal((await request("/api/notifications/b-only", { method: "DELETE", token: b.sessionToken })).status, 200);
    const stored = await db.readDb();
    assert.ok(stored.notifications.some((item) => item.id === published.notificationId));
    assert.ok(stored.notifications.some((item) => item.id === "b-only"));
    assert.ok(stored.notificationReads.find((item) => item.memberId === a.member.id && item.notificationId === published.notificationId).deletedAt);
  } finally { await server.close(); }
});

test("deleted messages are filtered before the inbox limit and stay deleted after later reads", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vip-delete-test-"));
  const previousUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "";
  const notifications = Array.from({ length: 202 }, (_, index) => ({ id: `notice-${index}`, title: "Update", memberId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }));
  const db = createDatabase({ rootDir, seedDatabase: { members: [], events: [], requests: [], notifications } });
  if (previousUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousUrl;
  try {
    await db.ensureDatabase();
    await db.deleteNotification("member-a", "notice-201");
    await db.deleteNotification("member-a", "notice-200");
    await db.markNotificationsRead("member-a", ["notice-201"]);
    const inbox = await db.listNotifications("member-a");
    assert.equal(inbox.length, 200);
    assert.ok(inbox.some((item) => item.id === "notice-0"));
    assert.ok(inbox.every((item) => !["notice-201", "notice-200"].includes(item.id)));
    assert.ok((await db.listNotifications("member-b")).some((item) => item.id === "notice-201"));
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test("Supabase deletion checks ownership then saves only that member's receipt", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const db = createDatabase({ rootDir: tmpdir(), seedDatabase: {} });
  if (previousUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = previousKey;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (options.method === "POST") return new Response(JSON.stringify([JSON.parse(options.body)]), { status: 201 });
    return new Response(JSON.stringify(new URL(url).searchParams.get("id") === "eq.visible" ? [{ id: "visible" }] : []));
  });
  assert.equal(await db.deleteNotification('member-a,("quoted")', "visible"), true);
  assert.equal(calls[0].url.searchParams.get("or"), '(member_id.is.null,member_id.eq."member-a,(\\"quoted\\")")');
  assert.equal(calls[1].url.pathname, "/rest/v1/vip_notification_reads");
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.member_id, 'member-a,("quoted")');
  assert.equal(body.notification_id, "visible");
  assert.ok(Number.isFinite(Date.parse(body.deleted_at)));
  assert.equal(calls[1].url.searchParams.get("on_conflict"), "notification_id,member_id");
  assert.equal(calls[1].options.headers.Prefer, "resolution=merge-duplicates,return=representation");
  assert.equal(await db.deleteNotification("member-a", "not-owned"), false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.options.method !== "DELETE"));
});
