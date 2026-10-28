import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startTestServer, signInMember } from "./test-server.mjs";
import { createDatabase } from "../database.mjs";
import { tmpdir } from "node:os";

const signup = { firstName: "Taylor", lastName: "Brooks", email: "taylor@example.com", phone: "4075550133",
  addressLine1: "123 Example Street", addressLine2: "Apt 4B", city: "Orlando", state: "FL", postalCode: "32801", country: "United States" };
const addressFields = ["addressLine1", "addressLine2", "city", "state", "postalCode", "country"];
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
  for (const field of addressFields) assert.equal(member[field], signup[field]);
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
  for (const field of addressFields) assert.equal(saved[field], signup[field]);
  const me = await fetch(server.origin + "/api/me", { headers: { Authorization: `Bearer ${sessionToken}` } }).then((r) => r.json());
  assert.equal(me.member.id, member.id);
  for (const field of addressFields) assert.equal(me.member[field], signup[field]);
  const relogin = await signInMember(server.origin, "TAYLOR@EXAMPLE.COM", "DE LA CRUZ");
  assert.equal(relogin.member.id, member.id);
  assert.equal(relogin.createdAccount, false);
  assert.equal((await verify(server, claim)).status, 400);
  const admin = await request(server, "/api/admin/login", { password: "local-feature-test" });
  const listed = await fetch(server.origin + "/api/admin/members", {
    headers: { Cookie: admin.headers.get("set-cookie").split(";")[0] },
  }).then((r) => r.json());
  assert.equal(listed.members.find((item) => item.id === member.id).status, "Active");
  for (const field of addressFields) assert.equal(listed.members.find((item) => item.id === member.id)[field], signup[field]);
  assert.equal((await fetch(server.origin + "/api/admin/members")).status, 401);
  assert.equal((await fetch(server.origin + "/api/me")).status, 401);
});

test("sign-up requires a complete address but allows omitted phone and unit", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  for (const invalid of [null, [], {}, { ...signup, firstName: " " }, { ...signup, lastName: {} },
    { ...signup, email: "bad-address" }, { ...signup, email: "a\nb@example.com" }, { ...signup, email: "a@b" },
    { ...signup, firstName: "A".repeat(101) }, { ...signup, city: "A".repeat(101) },
    { ...signup, phone: "abc" }, { ...signup, phone: "123" }, { ...signup, phone: "1".repeat(16) }, { ...signup, phone: {} },
    ...["addressLine1", "city", "state", "postalCode", "country"].flatMap((field) => [
      { ...signup, [field]: undefined }, { ...signup, [field]: " " }, { ...signup, [field]: {} },
    ]), { ...signup, addressLine1: "A".repeat(201) }, { ...signup, addressLine2: "A".repeat(201) },
    { ...signup, state: "A".repeat(101) }, { ...signup, country: "A".repeat(101) },
    { ...signup, postalCode: "ABC" }, { ...signup, postalCode: "1234" }, { ...signup, postalCode: "12345-678" }]) {
    assert.equal((await request(server, "/api/signup/start", invalid)).status, 400, JSON.stringify(invalid));
  }
  assert.equal((await request(server, "/api/claim/verify", null)).status, 400);
  const start = await request(server, "/api/signup/start", { ...signup, firstName: "Ren\u00e9e", lastName: "O'Neil-Smith", phone: undefined, addressLine2: undefined });
  assert.equal(start.status, 200);
  const response = await verify(server, await start.json());
  assert.equal(response.status, 200);
  const { member } = await response.json();
  assert.equal(member.name, "Ren\u00e9e O'Neil-Smith");
  assert.equal(member.phone, "");
  assert.equal(member.addressLine2, "");
  assert.equal(member.city, "Orlando");
});

test("sign-up normalizes mailing fields, preserves ZIP leading zeros, and accepts international postal codes", async (t) => {
  const server = await startTestServer();
  t.after(server.close);
  const cases = [
    { email: "one@example.com", postalCode: " 012345678 ", country: " USA ", state: " fl ", expectedZip: "01234-5678", expectedCountry: "United States", expectedState: "FL" },
    { email: "two@example.com", postalCode: " k1a 0b1 ", country: " Canada ", state: " Ontario ", expectedZip: "K1A 0B1", expectedCountry: "Canada", expectedState: "Ontario" },
  ];
  for (const item of cases) {
    const start = await request(server, "/api/signup/start", { ...signup, ...item, phone: "", addressLine1: " 123   Example Street ", addressLine2: " Apt   4B ", city: " Orlando " });
    assert.equal(start.status, 200);
    const response = await verify(server, await start.json());
    assert.equal(response.status, 200);
    const { member } = await response.json();
    assert.equal(member.addressLine1, signup.addressLine1);
    assert.equal(member.addressLine2, signup.addressLine2);
    assert.equal(member.postalCode, item.expectedZip);
    assert.equal(member.country, item.expectedCountry);
    assert.equal(member.state, item.expectedState);
  }
});

test("Supabase maps all mailing fields on create and read, while unrelated member edits preserve them", async (t) => {
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
  let row;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: new URL(url), options, body });
    if (options.method === "POST") row = body;
    if (options.method === "PATCH") row = { ...row, ...body };
    return new Response(JSON.stringify([row]));
  });
  const member = await db.createMember({ ...signup, id: "member-address", name: "Taylor Brooks", status: "Active" });
  assert.equal(calls[0].body.address_line1, signup.addressLine1);
  assert.equal(calls[0].body.address_line2, signup.addressLine2);
  assert.equal(calls[0].body.postal_code, signup.postalCode);
  assert.equal(calls[0].body.state, signup.state);
  assert.equal(calls[0].body.country, signup.country);
  for (const field of addressFields) assert.equal(member[field], signup[field]);
  const reloaded = await db.getMemberById(member.id);
  for (const field of addressFields) assert.equal(reloaded[field], signup[field]);
  const renamed = await db.updateMember(member.id, { firstName: "Taylor Anne" });
  assert.deepEqual(calls.at(-1).body, { first_name: "Taylor Anne" });
  for (const field of addressFields) assert.equal(renamed[field], signup[field]);
  const updated = await db.updateMember(member.id, { addressLine1: "456 Test Road", addressLine2: "", city: "Tampa", state: "FL", postalCode: "33602", country: "United States" });
  assert.deepEqual(calls.at(-1).body, { address_line1: "456 Test Road", address_line2: "", city: "Tampa", state: "FL", postal_code: "33602", country: "United States" });
  assert.equal(updated.addressLine1, "456 Test Road");
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
