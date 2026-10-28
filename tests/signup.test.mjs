import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startTestServer, signInMember } from "./test-server.mjs";

const signup = { firstName: "Taylor", lastName: "Brooks", email: "taylor@example.com", phone: "4075550133", city: "Orlando" };
const request = (server, path, body) => fetch(server.origin + path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const members = async (server) => JSON.parse(await readFile(join(server.directory, "data/vip-db.json"), "utf8")).members;
const verify = (server, claim, code = claim.devCode) => request(server, "/api/claim/verify", { claimToken: claim.claimToken, code });

test("sign-up activates only after email verification, persists an ordinary member and restores login", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const originalCount = (await members(server)).length;
  const response = await request(server, "/api/signup/start", { ...signup,
    firstName: "  Taylor   Anne ", lastName: " de la Cruz ", email: " TAYLOR@EXAMPLE.COM ", phone: "(407) 555-0133",
    status: "Paused", cardName: "Do not use this", memberId: "Injected", passwordHash: "Injected",
    preferences: { smsAlerts: true }, claimedAt: "2000-01-01", id: "existing-id" });
  assert.equal(response.status, 200);
  const claim = await response.json();
  assert.ok(claim.claimToken);
  assert.equal(claim.destination, "ta***@example.com");
  assert.equal((await members(server)).length, originalCount);
  assert.equal((await verify(server, claim, "000000")).status, 400);
  assert.equal((await members(server)).length, originalCount);
  const verified = await verify(server, claim);
  assert.equal(verified.status, 200);
  const { member, sessionToken, createdAccount } = await verified.json();
  assert.equal(createdAccount, true);
  assert.equal(member.name, "Taylor Anne de la Cruz");
  assert.equal(member.cardName, member.name);
  assert.equal(member.email, signup.email);
  assert.equal(member.phone, signup.phone);
  assert.equal(member.city, signup.city);
  assert.equal(member.status, "Active");
  assert.ok(member.claimedAt);
  assert.notEqual(member.id, "existing-id");
  assert.notEqual(member.memberId, "Injected");
  assert.equal(member.hasPassword, false);
  assert.deepEqual(member.preferences, { smsAlerts: false, emailUpdates: false, walletUpdates: false });
  assert.ok(sessionToken);
  assert.match(verified.headers.get("set-cookie"), /vip_session=/);
  assert.equal((await members(server)).length, originalCount + 1);
  const saved = (await members(server)).find((item) => item.id === member.id);
  assert.equal(saved.email, member.email);
  const me = await fetch(server.origin + "/api/me", { headers: { Authorization: `Bearer ${sessionToken}` } }).then((r) => r.json());
  assert.equal(me.member.id, member.id);
  const relogin = await signInMember(server.origin, "TAYLOR@EXAMPLE.COM", "DE LA CRUZ");
  assert.equal(relogin.member.id, member.id);
  assert.equal(relogin.createdAccount, false);
  assert.equal((await verify(server, claim)).status, 400);
  const admin = await request(server, "/api/admin/login", { password: "local-feature-test" });
  const listed = await fetch(server.origin + "/api/admin/members", {
    headers: { Cookie: admin.headers.get("set-cookie").split(";")[0] },
  }).then((r) => r.json());
  assert.equal(listed.members.find((item) => item.id === member.id).status, "Active");
});

test("sign-up validates fields and allows omitted phone and city", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  for (const invalid of [null, [], {}, { ...signup, firstName: " " }, { ...signup, lastName: {} },
    { ...signup, email: "bad-address" }, { ...signup, email: "a\nb@example.com" }, { ...signup, email: "a@b" },
    { ...signup, firstName: "A".repeat(101) }, { ...signup, city: "A".repeat(101) },
    { ...signup, phone: "abc" }, { ...signup, phone: "123" }, { ...signup, phone: "1".repeat(16) }, { ...signup, phone: {} }]) {
    assert.equal((await request(server, "/api/signup/start", invalid)).status, 400, JSON.stringify(invalid));
  }
  assert.equal((await request(server, "/api/claim/verify", null)).status, 400);
  const start = await request(server, "/api/signup/start", { firstName: "Ren\u00e9e", lastName: "O'Neil-Smith", email: signup.email });
  assert.equal(start.status, 200);
  const response = await verify(server, await start.json());
  assert.equal(response.status, 200);
  const { member } = await response.json();
  assert.equal(member.name, "Ren\u00e9e O'Neil-Smith");
  assert.equal(member.phone, "");
  assert.equal(member.city, "");
});

test("sign-up cannot duplicate or overwrite existing or paused VIPs by email or phone", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const original = await members(server);
  for (const existing of original) {
    assert.equal((await request(server, "/api/signup/start", { ...signup, email: ` ${existing.email.toUpperCase()} ` })).status, 409);
    assert.equal((await request(server, "/api/signup/start", { ...signup, phone: existing.phone })).status, 409);
  }
  assert.deepEqual(await members(server), original);
});

test("duplicate checks run again at verification and concurrent sign-ups create just one account", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const one = await request(server, "/api/signup/start", signup).then((r) => r.json());
  const two = await request(server, "/api/signup/start", signup).then((r) => r.json());
  const responses = await Promise.all([verify(server, one), verify(server, two)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await members(server)).filter((m) => m.email === signup.email).length, 1);
  const another = await request(server, "/api/signup/start", { ...signup, email: "other@example.com", phone: "" }).then((r) => r.json());
  const repeated = await Promise.all([verify(server, another), verify(server, another)]);
  assert.equal(repeated.filter((r) => r.status === 200).length, 1);
  assert.equal((await members(server)).filter((m) => m.email === "other@example.com").length, 1);
});

test("sign-up limits repeat email requests and incorrect verification attempts", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  let claim;
  for (let count = 0; count < 3; count += 1) {
    const response = await request(server, "/api/signup/start", signup);
    assert.equal(response.status, 200);
    claim = await response.json();
  }
  const blocked = await request(server, "/api/signup/start", { ...signup, email: signup.email.toUpperCase() });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  for (let count = 0; count < 6; count += 1) assert.equal((await verify(server, claim, "000000")).status, 400);
  assert.equal((await verify(server, claim)).status, 400);
  assert.equal((await members(server)).some((m) => m.email === signup.email), false);
});

test("sign-up with no working email service cannot create a member or return a usable token", async (t) => {
  const server = await startTestServer({ showCodes: false });
  t.after(server.close);
  const response = await request(server, "/api/signup/start", signup);
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.claimToken, undefined);
  assert.equal(result.devCode, undefined);
  assert.match(result.message, /could not be sent/);
  assert.equal((await members(server)).some((m) => m.email === signup.email), false);
});
