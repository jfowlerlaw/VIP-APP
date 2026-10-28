import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { startTestServer, signInMember } from "./test-server.mjs";

const address = { addressLine1: "123 Example Street", addressLine2: "Apt 4B", city: "Orlando", state: "FL", postalCode: "32801", country: "United States" };
const request = (server, path, { method = "POST", body = {}, token } = {}) => fetch(server.origin + path, {
  method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: method === "GET" ? undefined : JSON.stringify(body),
});
const me = (server, token) => request(server, "/api/me", { method: "GET", token });
const startChange = (server, token, email) => request(server, "/api/profile/email/start", { token, body: { email } });
const verifyChange = (server, token, challenge, code = challenge.devCode, extra = {}) => request(server, "/api/profile/email/verify", {
  token, body: { changeToken: challenge.changeToken, code, currentCode: challenge.devCurrentCode, ...extra },
});
const stored = (server) => readFile(join(server.directory, "data/vip-db.json"), "utf8").then(JSON.parse);
const sentMail = async (server) => (await readFile(join(server.directory, "mail.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const mailCode = (mail) => mail.content[0].value.match(/^\d{6}$/m)[0];

test("members edit their own details, preserve membership fields, and use their new last name next login", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const session = await signInMember(server.origin);
  const other = await signInMember(server.origin, "jordan@example.com", "Rivera");
  const originalOther = (await me(server, other.sessionToken).then((r) => r.json())).member;
  const body = { firstName: " Avery   Anne ", lastName: " de la Cruz ", phone: "(407) 555-0123", ...address,
    cardName: session.member.cardName, id: other.member.id, memberId: "Injected", status: "Paused", joined: "1900", passwordHash: "Injected",
    preferences: { emailUpdates: false, isAdmin: true } };
  assert.equal((await request(server, "/api/profile", { body })).status, 401);
  const response = await request(server, "/api/profile", { token: session.sessionToken, body });
  assert.equal(response.status, 200);
  const { member } = await response.json();
  assert.equal(member.id, session.member.id);
  assert.equal(member.name, "Avery Anne de la Cruz");
  assert.equal(member.cardName, member.name);
  assert.equal(member.phone, "4075550123");
  for (const [key, value] of Object.entries(address)) assert.equal(member[key], value);
  for (const key of ["email", "memberId", "status", "joined", "hasPassword"]) assert.equal(member[key], session.member[key]);
  assert.equal(member.preferences.emailUpdates, false);
  assert.equal(member.preferences.isAdmin, undefined);
  assert.deepEqual((await me(server, other.sessionToken).then((r) => r.json())).member, originalOther);
  assert.equal((await me(server, session.sessionToken).then((r) => r.json())).member.name, member.name);
  assert.equal((await request(server, "/api/claim/start", { body: { identity: member.email, lastName: "Mitchell" } })).status, 404);
  assert.equal((await signInMember(server.origin, member.email, "DE LA CRUZ")).member.id, member.id);
});

test("legacy profiles need not add an address to edit names, and custom card names are preserved", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const session = await signInMember(server.origin);
  const token = session.sessionToken;
  const custom = await request(server, "/api/profile", { token, body: { cardName: "Captain Moe" } }).then((r) => r.json());
  assert.equal(custom.member.cardName, "Captain Moe");
  const response = await request(server, "/api/profile", { token, body: { firstName: "Alex", lastName: "Mitchell",
    addressLine1: "", addressLine2: "", city: session.member.city, state: "", postalCode: "", country: "" } });
  assert.equal(response.status, 200);
  const { member } = await response.json();
  assert.equal(member.name, "Alex Mitchell");
  assert.equal(member.cardName, "Captain Moe");
  assert.equal(member.addressLine1, "");
  assert.equal((await request(server, "/api/profile", { token, body: { ...address } })).status, 200);
  const renamed = await request(server, "/api/profile", { token, body: { firstName: "Alexa", lastName: "Mitchell" } }).then((r) => r.json());
  assert.equal(renamed.member.cardName, "Captain Moe");
  for (const [key, value] of Object.entries(address)) assert.equal(renamed.member[key], value);
  const resetCard = await request(server, "/api/profile", { token, body: { cardName: "" } }).then((r) => r.json());
  assert.equal(resetCard.member.cardName, "Alexa Mitchell");
  const longName = await request(server, "/api/profile", { token, body: { firstName: "A".repeat(100), lastName: "B".repeat(100) } }).then((r) => r.json());
  assert.equal(longName.member.cardName.length, 201);
  assert.equal((await request(server, "/api/profile", { token, body: { cardName: longName.member.cardName, phone: "" } })).status, 200);
});

test("profile validation is atomic, rejects duplicate phones, and does not allow direct email changes", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const session = await signInMember(server.origin);
  const token = session.sessionToken;
  const original = session.member;
  for (const body of [null, [], { firstName: "" }, { firstName: {} }, { lastName: "X".repeat(101) },
    { cardName: "X".repeat(202) }, { phone: {} }, { phone: "abc" }, { phone: "123" }, { phone: "1".repeat(16) },
    { firstName: "Should not save", email: "new@example.com" }, { preferences: { smsAlerts: "yes" } },
    { ...address, postalCode: "bad" }, { addressLine1: "123 Test St" }, { ...address, city: "" }, { country: {} }]) {
    assert.equal((await request(server, "/api/profile", { token, body })).status, 400, JSON.stringify(body));
    assert.deepEqual((await me(server, token).then((r) => r.json())).member, original);
  }
  assert.equal((await request(server, "/api/profile", { token, body: { phone: "4075550199", firstName: "Must not save" } })).status, 409);
  assert.deepEqual((await me(server, token).then((r) => r.json())).member, original);
});

test("verified email changes send to the new mailbox, notify the old one, rotate sessions, and invalidate old codes", async (t) => {
  const server = await startTestServer({ showCodes: false, mailStatus: 202 });
  t.after(server.close);
  const signIn = async () => {
    const claim = await request(server, "/api/claim/start", { body: { identity: "avery@example.com", lastName: "Mitchell" } }).then((r) => r.json());
    assert.equal(claim.devCode, undefined);
    const code = mailCode((await sentMail(server)).at(-1));
    return request(server, "/api/claim/verify", { body: { claimToken: claim.claimToken, code } }).then((r) => r.json());
  };
  const session = await signIn();
  const secondSession = await signIn();
  const staleClaim = await request(server, "/api/claim/start", { body: { identity: "avery@example.com", lastName: "Mitchell" } }).then((r) => r.json());
  const staleCode = mailCode((await sentMail(server)).at(-1));
  const response = await startChange(server, session.sessionToken, " NEW@EXAMPLE.COM ");
  assert.equal(response.status, 200);
  const challenge = await response.json();
  assert.ok(challenge.changeToken);
  assert.equal(challenge.devCode, undefined);
  assert.equal(challenge.devCurrentCode, undefined);
  assert.equal(challenge.destination, "ne***@example.com");
  const message = (await sentMail(server)).at(-1);
  assert.equal(message.personalizations[0].to[0].email, "new@example.com");
  assert.equal(message.personalizations[0].subject, "Confirm your new Moe VIP email");
  const code = mailCode(message);
  const confirmation = (await sentMail(server)).findLast((mail) => mail.personalizations[0].subject === "Approve your Moe VIP email change");
  assert.equal(confirmation.personalizations[0].to[0].email, "avery@example.com");
  const currentCode = mailCode(confirmation);
  assert.notEqual(currentCode, code);
  assert.equal((await me(server, session.sessionToken).then((r) => r.json())).member.email, "avery@example.com");
  assert.equal((await verifyChange(server, session.sessionToken, challenge, "000000")).status, 400);
  assert.equal((await verifyChange(server, session.sessionToken, challenge, "000000", { currentCode })).status, 400);
  assert.equal((await verifyChange(server, session.sessionToken, challenge, code)).status, 400);
  assert.equal((await verifyChange(server, session.sessionToken, challenge, code, { currentCode: "000000" })).status, 400);
  const verified = await verifyChange(server, session.sessionToken, challenge, code, { currentCode, email: "not-the-requested@example.com", memberId: "other" });
  assert.equal(verified.status, 200);
  const result = await verified.json();
  assert.equal(result.member.email, "new@example.com");
  assert.equal(result.member.id, session.member.id);
  assert.notEqual(result.sessionToken, session.sessionToken);
  assert.equal((await me(server, session.sessionToken)).status, 401);
  assert.equal((await me(server, secondSession.sessionToken)).status, 401);
  assert.equal((await me(server, result.sessionToken)).status, 200);
  assert.equal((await request(server, "/api/claim/verify", { body: { claimToken: staleClaim.claimToken, code: staleCode } })).status, 400);
  assert.equal((await verifyChange(server, result.sessionToken, challenge, code)).status, 400);
  assert.equal((await request(server, "/api/claim/start", { body: { identity: "avery@example.com", lastName: "Mitchell" } })).status, 404);
  const newClaim = await request(server, "/api/claim/start", { body: { identity: "new@example.com", lastName: "Mitchell" } });
  assert.equal(newClaim.status, 200);
  let notice;
  for (let count = 0; count < 20 && !notice; count += 1) {
    notice = (await sentMail(server)).find((mail) => mail.personalizations[0].subject === "Your Moe VIP email address was changed");
    if (!notice) await setTimeout(10);
  }
  assert.ok(notice);
  assert.equal(notice.personalizations[0].to[0].email, "avery@example.com");
  assert.match(notice.content[0].value, /new@example\.com/);
});

test("email changes require the owner, reject duplicates at start and verification, and support cancellation", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const session = await signInMember(server.origin);
  const other = await signInMember(server.origin, "jordan@example.com", "Rivera");
  const token = session.sessionToken;
  for (const [path, method] of [["/api/profile/email/start", "POST"], ["/api/profile/email/verify", "POST"], ["/api/profile/email", "DELETE"]]) {
    assert.equal((await request(server, path, { method })).status, 401);
  }
  for (const email of ["bad", "avery@example.com", " AVERY@EXAMPLE.COM "]) assert.equal((await startChange(server, token, email)).status, 400);
  assert.equal((await startChange(server, token, "JORDAN@example.com")).status, 409);
  const one = await startChange(server, token, "new@example.com").then((r) => r.json());
  assert.equal((await verifyChange(server, other.sessionToken, one)).status, 400);
  await request(server, "/api/profile/email", { method: "DELETE", token: other.sessionToken, body: { changeToken: one.changeToken } });
  const two = await startChange(server, token, "new@example.com").then((r) => r.json());
  assert.equal((await verifyChange(server, token, one)).status, 400);
  assert.equal((await request(server, "/api/profile/email", { method: "DELETE", token, body: { changeToken: two.changeToken } })).status, 200);
  assert.equal((await verifyChange(server, token, two)).status, 400);
  const three = await startChange(server, token, "later@example.com").then((r) => r.json());
  const admin = await request(server, "/api/admin/login", { body: { password: "local-feature-test" } });
  await fetch(server.origin + "/api/admin/members", { method: "POST", headers: { "Content-Type": "application/json", Cookie: admin.headers.get("set-cookie").split(";")[0] },
    body: JSON.stringify({ firstName: "Another", lastName: "Person", email: "later@example.com", phone: "" }) });
  assert.equal((await verifyChange(server, token, three)).status, 409);
  assert.equal((await me(server, token).then((r) => r.json())).member.email, session.member.email);
});

test("email-change codes expire, are attempt-limited, rate-limited, and cannot be confirmed twice", async (t) => {
  const server = await startTestServer({ mockClock: true });
  t.after(server.close);
  const session = await signInMember(server.origin);
  const token = session.sessionToken;
  const expired = await startChange(server, token, "new@example.com").then((r) => r.json());
  await writeFile(join(server.directory, "clock-offset"), String(16 * 60 * 1000));
  assert.equal((await verifyChange(server, token, expired)).status, 400);
  const attempts = await startChange(server, token, "new@example.com").then((r) => r.json());
  for (let count = 0; count < 6; count += 1) assert.equal((await verifyChange(server, token, attempts, "000000")).status, 400);
  assert.equal((await verifyChange(server, token, attempts)).status, 400);
  const valid = await startChange(server, token, "new@example.com").then((r) => r.json());
  assert.equal((await startChange(server, token, "another@example.com")).status, 200);
  const limited = await startChange(server, token, "new@example.com");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  // The most recent code supersedes earlier requests; use a fresh window for the parallel confirmation.
  assert.equal((await verifyChange(server, token, valid)).status, 400);
  await writeFile(join(server.directory, "clock-offset"), String(32 * 60 * 1000));
  const latest = await startChange(server, token, "new@example.com").then((r) => r.json());
  const results = await Promise.all([verifyChange(server, token, latest), verifyChange(server, token, latest)]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal((await stored(server)).members.filter((m) => m.email === "new@example.com").length, 1);
});

test("a failed verification email leaves the current email intact and exposes no change token", async (t) => {
  const server = await startTestServer({ showCodes: false, mailStatus: 400 });
  t.after(server.close);
  const db = await stored(server);
  const member = db.members[0];
  db.memberSessions = [{ token: "fixture-session", memberId: member.id, expiresAt: new Date(Date.now() + 3600000).toISOString(), createdAt: new Date().toISOString() }];
  await writeFile(join(server.directory, "data/vip-db.json"), JSON.stringify(db));
  const response = await startChange(server, "fixture-session", "new@example.com");
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.changeToken, undefined);
  assert.match(body.message, /has not changed/);
  assert.equal((await me(server, "fixture-session").then((r) => r.json())).member.email, member.email);
});
