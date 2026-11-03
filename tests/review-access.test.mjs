import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "../database.mjs";
import { startTestServer, signInMember } from "./test-server.mjs";

// Test-only credentials, never used in a deployed environment.
const reviewCode = "836291";
const reviewEmail = "reviewer@moevip.example";
const request = (server, path, { method = "POST", body = {}, token } = {}) => fetch(server.origin + path, {
  method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: method === "GET" ? undefined : JSON.stringify(body),
});
const startReview = (server, body = {}) => request(server, "/api/claim/start", { body: { identity: reviewEmail, lastName: "Review", ...body } });
const verify = (server, claim, code = reviewCode) => request(server, "/api/claim/verify", { body: { claimToken: claim.claimToken, code } });
const signInReview = async (server) => {
  const start = await startReview(server);
  assert.equal(start.status, 200);
  const response = await verify(server, await start.json());
  assert.equal(response.status, 200);
  return response.json();
};
const stored = (server) => readFile(join(server.directory, "data/vip-db.json"), "utf8").then(JSON.parse);

test("review access is disabled without configuration, including saved review sessions and alternate sign-in addresses", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  assert.equal((await startReview(server)).status, 404);
  const db = await stored(server);
  assert.ok(!db.members.some((m) => m.preferences.appReview));
  db.members.push({ ...db.members[0], id: "review_disabled", email: "changed@moevip.example", preferences: { appReview: true } });
  db.memberSessions ||= [];
  db.memberSessions.push({ token: "old-review-session", memberId: "review_disabled", expiresAt: new Date(Date.now() + 60000).toISOString() });
  await writeFile(join(server.directory, "data/vip-db.json"), JSON.stringify(db));
  assert.equal((await request(server, "/api/me", { method: "GET", token: "old-review-session" })).status, 401);
  assert.equal((await request(server, "/api/claim/start", { body: { identity: "changed@moevip.example", lastName: "Mitchell" } })).status, 404);
});

test("review login provisions one sample member, never sends email or exposes its code, and requires the configured code", async (t) => {
  const server = await startTestServer({ showCodes: false, mailStatus: 202, reviewCode });
  t.after(server.close);
  const before = await stored(server);
  assert.equal((await startReview(server, { lastName: "Wrong" })).status, 404);
  const response = await startReview(server, { identity: ` ${reviewEmail.toUpperCase()} `, lastName: " REVIEW " });
  assert.equal(response.status, 200);
  const claim = await response.json();
  assert.equal(claim.reviewAccount, true);
  assert.equal(claim.email.status, "review");
  assert.equal(claim.devCode, undefined);
  assert.ok(!JSON.stringify(claim).includes(reviewCode));
  assert.equal((await verify(server, claim, "000000")).status, 400);
  const session = await verify(server, claim).then((r) => r.json());
  assert.equal(session.member.name, "Apple Review");
  assert.equal(session.member.isReviewAccount, true);
  assert.equal(session.member.email, reviewEmail);
  assert.ok(session.member.id.startsWith("review_"));
  const after = await stored(server);
  assert.deepEqual(after.members.filter((m) => !m.id.startsWith("review_")), before.members);
  assert.equal(after.members.filter((m) => m.preferences.appReview).length, 1);
  const inbox = await request(server, "/api/notifications", { method: "GET", token: session.sessionToken }).then((r) => r.json());
  assert.ok(inbox.notifications.some((n) => n.body.includes("sample message")));
  await assert.rejects(readFile(join(server.directory, "mail.jsonl")), { code: "ENOENT" });
});

test("review codes cannot sign in as real members, grant admin access, or mark a normal profile as a review account", async (t) => {
  const server = await startTestServer({ reviewCode });
  t.after(server.close);
  const claim = await request(server, "/api/claim/start", { body: { identity: "avery@example.com", lastName: "Mitchell" } }).then((r) => r.json());
  assert.equal((await verify(server, claim)).status, 400);
  const real = await verify(server, claim, claim.devCode).then((r) => r.json());
  assert.equal(real.member.isReviewAccount, false);
  const edited = await request(server, "/api/profile", { token: real.sessionToken, body: { preferences: { appReview: true }, isReviewAccount: true } }).then((r) => r.json());
  assert.equal(edited.member.isReviewAccount, false);
  assert.equal(edited.member.preferences.appReview, undefined);
  const review = await signInReview(server);
  assert.equal((await request(server, "/api/admin/members", { method: "GET", token: review.sessionToken })).status, 401);
  const reserved = { firstName: "Fake", lastName: "Person", email: reviewEmail, addressLine1: "123 Test St", city: "Orlando", state: "FL", postalCode: "32801", country: "United States" };
  assert.equal((await request(server, "/api/signup/start", { body: reserved })).status, 409);
  assert.equal((await request(server, "/api/profile/email/start", { token: real.sessionToken, body: { email: reviewEmail } })).status, 400);
});

test("simultaneous reviewer sign-ins share one sample account and all receive usable sessions", async (t) => {
  const server = await startTestServer({ reviewCode });
  t.after(server.close);
  const starts = await Promise.all(Array.from({ length: 4 }, () => startReview(server).then((r) => r.json())));
  assert.ok(starts.every((claim) => !claim.devCode && claim.reviewAccount));
  const sessions = await Promise.all(starts.map((claim) => verify(server, claim).then((r) => r.json())));
  assert.equal(new Set(sessions.map((s) => s.member.id)).size, 1);
  const db = await stored(server);
  assert.equal(db.members.filter((m) => m.preferences.appReview).length, 1);
  assert.equal(db.memberSessions.filter((s) => s.memberId === sessions[0].member.id).length, 4);
  for (const session of sessions) assert.equal((await request(server, "/api/me", { method: "GET", token: session.sessionToken })).status, 200);
});

test("reviewer profile, help, and inbox actions affect only the sample account and never send real email", async (t) => {
  const server = await startTestServer({ reviewCode, showCodes: false, mailStatus: 202 });
  t.after(server.close);
  const before = await stored(server);
  const session = await signInReview(server);
  const token = session.sessionToken;
  const updated = await request(server, "/api/profile", { token, body: { firstName: "Sample", lastName: "Tester", preferences: { appReview: false } } }).then((r) => r.json());
  assert.equal(updated.member.name, "Sample Tester");
  assert.equal(updated.member.isReviewAccount, true);
  const inbox = await request(server, "/api/notifications", { method: "GET", token }).then((r) => r.json());
  const notice = inbox.notifications[0];
  assert.equal((await request(server, `/api/notifications/${notice.id}/read`, { method: "PATCH", token })).status, 200);
  assert.equal((await request(server, `/api/notifications/${notice.id}`, { method: "DELETE", token })).status, 200);
  assert.equal((await request(server, "/api/notifications", { method: "GET", token }).then((r) => r.json())).notifications.length, 0);
  const help = await request(server, "/api/requests", { token, body: { type: "Other", phone: "4075550100", message: "Sample request" } });
  assert.equal(help.status, 201);
  const result = await help.json();
  assert.equal(result.email.status, "review");
  assert.equal(result.request.memberId, session.member.id);
  assert.equal(result.request.emailStatus, "review");
  const registration = await request(server, "/api/push/register", { token, body: { token: "sample-review-push-token", platform: "ios" } });
  assert.equal(registration.status, 200);
  assert.equal((await stored(server)).pushTokens.find((push) => push.token === "sample-review-push-token").memberId, session.member.id);
  const after = await stored(server);
  assert.deepEqual(after.members.filter((m) => !m.id.startsWith("review_")), before.members);
  assert.deepEqual(after.requests.filter((r) => r.memberId !== session.member.id), before.requests);
  await assert.rejects(readFile(join(server.directory, "mail.jsonl")), { code: "ENOENT" });
});

test("review email changes use the review code only for sample addresses and retain fixed reviewer sign-in credentials", async (t) => {
  const server = await startTestServer({ reviewCode, showCodes: false, mailStatus: 202 });
  t.after(server.close);
  const session = await signInReview(server);
  const token = session.sessionToken;
  assert.equal((await request(server, "/api/profile/email/start", { token, body: { email: "real@example.com" } })).status, 400);
  const challenge = await request(server, "/api/profile/email/start", { token, body: { email: "updated@moevip.example" } }).then((r) => r.json());
  assert.equal(challenge.reviewAccount, true);
  assert.equal(challenge.devCode, undefined);
  assert.equal(challenge.devCurrentCode, undefined);
  const changed = await request(server, "/api/profile/email/verify", { token, body: { changeToken: challenge.changeToken, code: reviewCode, currentCode: reviewCode } });
  assert.equal(changed.status, 200);
  const { member } = await changed.json();
  assert.equal(member.email, "updated@moevip.example");
  assert.equal(member.isReviewAccount, true);
  const again = await signInReview(server);
  assert.equal(again.member.id, member.id);
  assert.equal(again.member.email, member.email);
  assert.equal((await request(server, "/api/claim/start", { body: { identity: member.email, lastName: "Review" } })).status, 404);
  await assert.rejects(readFile(join(server.directory, "mail.jsonl")), { code: "ENOENT" });
});

test("review account deletion removes its data and sessions; the next reviewer login gets a new sample account", async (t) => {
  const server = await startTestServer({ reviewCode, showCodes: false });
  t.after(server.close);
  const session = await signInReview(server);
  const token = session.sessionToken;
  const before = await stored(server);
  const start = await request(server, "/api/profile/delete/start", { token }).then((r) => r.json());
  assert.equal(start.reviewAccount, true);
  assert.equal(start.devCode, undefined);
  const response = await request(server, "/api/profile", { method: "DELETE", token, body: { deleteToken: start.deleteToken, code: reviewCode } });
  assert.equal(response.status, 200);
  const after = await stored(server);
  assert.ok(!after.members.some((m) => m.id === session.member.id));
  assert.ok(!after.notifications.some((n) => n.memberId === session.member.id));
  assert.ok(!after.memberSessions.some((s) => s.memberId === session.member.id));
  assert.deepEqual(after.members, before.members.filter((m) => m.id !== session.member.id));
  const fresh = await signInReview(server);
  assert.notEqual(fresh.member.id, session.member.id);
  assert.equal(fresh.member.name, "Apple Review");
  assert.equal((await request(server, "/api/me", { method: "GET", token })).status, 401);
});

test("review challenges expire, limit incorrect codes, and limit new challenge requests", async (t) => {
  const server = await startTestServer({ reviewCode, mockClock: true });
  t.after(server.close);
  const expired = await startReview(server).then((r) => r.json());
  await writeFile(join(server.directory, "clock-offset"), String(16 * 60 * 1000));
  assert.equal((await verify(server, expired)).status, 400);
  const challenged = await startReview(server).then((r) => r.json());
  for (let i = 0; i < 6; i++) assert.equal((await verify(server, challenged, "000000")).status, 400);
  assert.equal((await verify(server, challenged)).status, 400);
  for (let i = 0; i < 29; i++) assert.equal((await startReview(server)).status, 200);
  assert.equal((await startReview(server)).status, 429);
});

test("invalid reviewer configuration fails closed without including its value in the error", async () => {
  await assert.rejects(startTestServer({ reviewCode: "not-a-code" }), (error) => {
    assert.match(error.message, /VIP_REVIEW_CODE must be/);
    assert.ok(!error.message.includes("not-a-code"));
    return true;
  });
});

test("local account snapshots remain valid JSON while concurrent reads and writes run", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "vip-atomic-test-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const previous = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "";
  const db = createDatabase({ rootDir, seedDatabase: { members: [{ id: "sample", name: "Sample" }], requests: [], events: [] } });
  if (previous === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous;
  await db.ensureDatabase();
  for (let i = 0; i < 30; i++) {
    await Promise.all([db.updateMember("sample", { name: "Sample ".repeat(500) }), ...Array.from({ length: 5 }, () => readFile(join(rootDir, "data/vip-db.json"), "utf8").then(JSON.parse))]);
  }
});

test("both native build configurations target iPhone only", async () => {
  const project = await readFile(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");
  assert.deepEqual(Array.from(project.matchAll(/TARGETED_DEVICE_FAMILY = ([^;]+);/g), (match) => match[1]), ["1", "1"]);
});
