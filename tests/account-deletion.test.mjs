import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "../database.mjs";
import { startTestServer, signInMember } from "./test-server.mjs";

const request = (server, path, { method = "POST", body = {}, token } = {}) => fetch(server.origin + path, {
  method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: method === "GET" ? undefined : JSON.stringify(body),
});
const startDeletion = (server, token) => request(server, "/api/profile/delete/start", { token });
const confirmDeletion = (server, token, challenge, extra = {}) => request(server, "/api/profile", {
  method: "DELETE", token, body: { deleteToken: challenge.deleteToken, code: challenge.devCode, ...extra },
});
const stored = (server) => readFile(join(server.directory, "data/vip-db.json"), "utf8").then(JSON.parse);

test("account deletion requires its owner's email code and removes only their account and associated records", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const owner = await signInMember(server.origin);
  const second = await signInMember(server.origin);
  const other = await signInMember(server.origin, "jordan@example.com", "Rivera");
  const staleClaim = await request(server, "/api/claim/start", { body: { identity: "avery@example.com", lastName: "Mitchell" } }).then((r) => r.json());
  const emailChange = await request(server, "/api/profile/email/start", { token: owner.sessionToken, body: { email: "new@example.com" } }).then((r) => r.json());
  const db = await stored(server);
  const id = owner.member.id;
  db.pushTokens = [{ id: "own-push", memberId: id, token: "own" }, { id: "other-push", memberId: other.member.id, token: "other" }];
  db.notifications = [{ id: "public", memberId: null }, { id: "own-notice", memberId: id }, { id: "other-notice", memberId: other.member.id }];
  db.notificationReads = [{ notificationId: "public", memberId: id }, { notificationId: "public", memberId: other.member.id }, { notificationId: "own-notice", memberId: id }];
  const otherBefore = db.members.find((m) => m.id === other.member.id);
  const ownRequestCount = db.requests.filter((r) => r.memberId === id).length;
  assert.ok(ownRequestCount > 0);
  await writeFile(join(server.directory, "data/vip-db.json"), JSON.stringify(db));
  assert.equal((await startDeletion(server)).status, 401);
  assert.equal((await confirmDeletion(server, owner.sessionToken, {})).status, 400);
  const challenge = await startDeletion(server, owner.sessionToken).then((r) => r.json());
  assert.ok(challenge.deleteToken);
  assert.equal((await stored(server)).members.length, db.members.length);
  assert.equal((await confirmDeletion(server, other.sessionToken, challenge)).status, 400);
  assert.equal((await confirmDeletion(server, owner.sessionToken, challenge, { code: "wrong" })).status, 400);
  const response = await confirmDeletion(server, owner.sessionToken, challenge, { memberId: other.member.id, id: other.member.id });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(response.headers.get("set-cookie"), /vip_session=;.*Max-Age=0/);
  const after = await stored(server);
  assert.ok(!after.members.some((m) => m.id === id));
  assert.deepEqual(after.members.find((m) => m.id === other.member.id), otherBefore);
  for (const field of ["requests", "pushTokens", "memberSessions", "notifications", "notificationReads"]) {
    assert.ok(!after[field].some((row) => row.memberId === id), field);
  }
  assert.equal(after.requests.length, db.requests.length - ownRequestCount);
  assert.deepEqual(after.notifications.map((n) => n.id), ["public", "other-notice"]);
  assert.deepEqual(after.notificationReads, [{ notificationId: "public", memberId: other.member.id }]);
  assert.equal(after.pushTokens[0].id, "other-push");
  for (const token of [owner.sessionToken, second.sessionToken]) {
    assert.equal((await request(server, "/api/me", { method: "GET", token })).status, 401);
  }
  assert.equal((await request(server, "/api/me", { method: "GET", token: other.sessionToken })).status, 200);
  assert.equal((await request(server, "/api/claim/verify", { body: { claimToken: staleClaim.claimToken, code: staleClaim.devCode } })).status, 400);
  assert.equal((await request(server, "/api/profile/email/verify", { token: owner.sessionToken, body: { changeToken: emailChange.changeToken, code: emailChange.devCode, currentCode: emailChange.devCurrentCode } })).status, 401);
  assert.equal((await confirmDeletion(server, owner.sessionToken, challenge)).status, 401);
});

test("deletion codes expire, limit attempts and resends, and permit just one concurrent deletion", async (t) => {
  const server = await startTestServer({ mockClock: true });
  t.after(server.close);
  const owner = await signInMember(server.origin);
  const token = owner.sessionToken;
  const first = await startDeletion(server, token).then((r) => r.json());
  const second = await startDeletion(server, token).then((r) => r.json());
  assert.equal((await confirmDeletion(server, token, first)).status, 400);
  for (let i = 0; i < 6; i++) assert.equal((await confirmDeletion(server, token, second, { code: "wrong" })).status, 400);
  assert.equal((await confirmDeletion(server, token, second)).status, 400);
  const expired = await startDeletion(server, token).then((r) => r.json());
  assert.equal((await startDeletion(server, token)).status, 429);
  await writeFile(join(server.directory, "clock-offset"), String(16 * 60 * 1000));
  assert.equal((await confirmDeletion(server, token, expired)).status, 400);
  const current = await startDeletion(server, token).then((r) => r.json());
  const responses = await Promise.all([confirmDeletion(server, token, current), confirmDeletion(server, token, current)]);
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.ok(responses.every((r) => [200, 401, 409].includes(r.status)));
});

test("changing the email invalidates an earlier account-deletion challenge", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const owner = await signInMember(server.origin);
  const challenge = await startDeletion(server, owner.sessionToken).then((r) => r.json());
  const email = await request(server, "/api/profile/email/start", { token: owner.sessionToken, body: { email: "changed@example.com" } }).then((r) => r.json());
  const changed = await request(server, "/api/profile/email/verify", { token: owner.sessionToken, body: { changeToken: email.changeToken, code: email.devCode, currentCode: email.devCurrentCode } }).then((r) => r.json());
  assert.equal((await confirmDeletion(server, changed.sessionToken, challenge)).status, 400);
  assert.equal((await request(server, "/api/me", { method: "GET", token: changed.sessionToken })).status, 200);
});

test("a paused membership does not prevent an authenticated owner from deleting their account", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const owner = await signInMember(server.origin);
  const db = await stored(server);
  db.members.find((m) => m.id === owner.member.id).status = "Paused";
  await writeFile(join(server.directory, "data/vip-db.json"), JSON.stringify(db));
  const response = await startDeletion(server, owner.sessionToken);
  assert.equal(response.status, 200);
  assert.equal((await confirmDeletion(server, owner.sessionToken, await response.json())).status, 200);
});

test("production deletion codes are emailed only to the owner and never returned by the API", async (t) => {
  const server = await startTestServer({ showCodes: false, mailStatus: 202 });
  t.after(server.close);
  const mails = async () => (await readFile(join(server.directory, "mail.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  const getCode = (mail) => mail.content[0].value.match(/^\d{6}$/m)[0];
  const claim = await request(server, "/api/claim/start", { body: { identity: "avery@example.com", lastName: "Mitchell" } }).then((r) => r.json());
  const owner = await request(server, "/api/claim/verify", { body: { claimToken: claim.claimToken, code: getCode((await mails()).at(-1)) } }).then((r) => r.json());
  const challenge = await request(server, "/api/profile/delete/start", { token: owner.sessionToken, body: { email: "attacker@example.com", memberId: "other" } }).then((r) => r.json());
  const mail = (await mails()).at(-1);
  assert.equal(mail.personalizations[0].to[0].email, "avery@example.com");
  assert.equal(mail.personalizations[0].subject, "Confirm deletion of your Moe VIP account");
  assert.match(mail.content[0].value, /permanently delete/);
  assert.equal(challenge.devCode, undefined);
  assert.equal((await confirmDeletion(server, owner.sessionToken, challenge, { code: getCode(mail) })).status, 200);
});

test("email delivery failure cannot return a usable deletion challenge or remove the account", async (t) => {
  const server = await startTestServer({ showCodes: false, mailStatus: 400 });
  t.after(server.close);
  const db = await stored(server);
  db.memberSessions = [{ token: "test-session", memberId: db.members[0].id, expiresAt: new Date(Date.now() + 60000).toISOString() }];
  await writeFile(join(server.directory, "data/vip-db.json"), JSON.stringify(db));
  const response = await startDeletion(server, "test-session");
  assert.equal(response.status, 502);
  assert.equal((await response.json()).deleteToken, undefined);
  assert.equal((await request(server, "/api/me", { method: "GET", token: "test-session" })).status, 200);
  assert.deepEqual((await stored(server)).members, db.members);
});

test("Supabase member deletion is scoped, verified, and backed by cascading foreign keys", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "vip-delete-test-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const db = createDatabase({ rootDir, seedDatabase: {} });
  for (const [key, value] of [["SUPABASE_URL", previous.url], ["SUPABASE_SECRET_KEY", previous.key]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const id = 'member-a,("quoted")';
  let confirmWrite = true;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (options.method === "DELETE") return new Response(JSON.stringify(confirmWrite ? [{ id }] : []));
    return new Response(JSON.stringify(parsed.pathname.endsWith("vip_members") ? [{ id, name: "Test Member", email: "test@example.com" }] : [{ id: "request" }]));
  });
  assert.equal((await db.deleteMember(id)).deletedMember.id, id);
  const deletion = calls.find((call) => call.options.method === "DELETE");
  assert.equal(deletion.url.searchParams.get("id"), `eq.${id}`);
  assert.equal(deletion.options.headers.Prefer, "return=representation");
  assert.ok(calls.every((call) => call.url.searchParams.get(call.url.pathname.endsWith("vip_members") ? "id" : "member_id") === `eq.${id}`));
  confirmWrite = false;
  await assert.rejects(db.deleteMember(id), /could not be confirmed/);
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  for (const table of ["vip_requests", "vip_push_tokens", "vip_member_sessions", "vip_notifications", "vip_notification_reads"]) {
    const definition = schema.slice(schema.indexOf(`create table if not exists public.${table} (`)).split(");")[0];
    assert.match(definition, /member_id text(?: not null)? references public.vip_members\(id\) on delete cascade/, table);
  }
});

test("privacy policy is available before sign-in and inside profile settings", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const auth = html.slice(html.indexOf('data-auth-screen'), html.indexOf('id="view-card"'));
  const settings = html.slice(html.indexOf('id="view-profile"'), html.indexOf('<nav class="bottom-nav"'));
  for (const section of [auth, settings]) {
    assert.match(section, /href="https:\/\/justcallmoe.com\/privacy-policy\/"[^>]*data-privacy-link/);
  }
  assert.match(settings, /data-delete-account/);
});
