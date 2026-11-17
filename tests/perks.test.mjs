import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../database.mjs";
import { startTestServer, signInMember } from "./test-server.mjs";

const ids = (perks) => perks.map((perk) => perk.id);

test("admins save email perks and persist their display order, including hidden perks", async () => {
  const server = await startTestServer();
  const request = (path, { method = "GET", body, cookie, token } = {}) => fetch(server.origin + path, {
    method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    assert.equal((await request("/api/admin/perks/reorder", { method: "POST", body: { ids: [] } })).status, 401);
    const member = await signInMember(server.origin);
    assert.equal((await request("/api/admin/perks/reorder", { method: "POST", token: member.sessionToken, body: { ids: [] } })).status, 401);
    const login = await request("/api/admin/login", { method: "POST", body: { password: "local-feature-test" } });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const emailUrl = "mailto:vip@example.com?subject=VIP%20gift%20%26%20questions&body=Hello%0D%0AVIP%20team";
    const created = await request("/api/admin/perks", { method: "POST", cookie,
      body: { title: "Email the VIP desk", actionUrl: emailUrl, buttonLabel: "Email us" } }).then((res) => res.json());
    assert.equal(created.perk.actionUrl, emailUrl);
    const hiddenId = created.perks.find((perk) => perk.id !== created.perk.id).id;
    await request(`/api/admin/perks/${hiddenId}`, { method: "PATCH", cookie, body: { visible: false } });
    const orderedIds = ids(created.perks).reverse();
    const reorder = await request("/api/admin/perks/reorder", { method: "POST", cookie, body: { ids: orderedIds } });
    assert.equal(reorder.status, 200);
    assert.deepEqual(ids((await reorder.json()).perks), orderedIds);
    const loaded = await request("/api/admin/perks", { cookie }).then((res) => res.json());
    assert.deepEqual(ids(loaded.perks), orderedIds);
    const publicList = await request("/api/perks").then((res) => res.json());
    assert.deepEqual(ids(publicList.perks), orderedIds.filter((id) => id !== hiddenId));
    await request(`/api/admin/perks/${created.perk.id}`, { method: "PATCH", cookie, body: { title: "Updated email perk" } });
    await request(`/api/admin/perks/${hiddenId}`, { method: "PATCH", cookie, body: { visible: true } });
    assert.deepEqual(ids((await request("/api/perks").then((res) => res.json())).perks), orderedIds);
    for (const value of [null, "bad", [orderedIds[0], orderedIds[0]], [null], [2], [" "]]) {
      assert.equal((await request("/api/admin/perks/reorder", { method: "POST", cookie, body: { ids: value } })).status, 400);
    }
    for (const value of [[], orderedIds.slice(1), orderedIds.map((id, i) => i ? id : "missing")]) {
      assert.equal((await request("/api/admin/perks/reorder", { method: "POST", cookie, body: { ids: value } })).status, 409);
    }
    assert.deepEqual(ids((await request("/api/admin/perks", { cookie }).then((res) => res.json())).perks), orderedIds);
    const previous = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    const restored = createDatabase({ rootDir: server.directory, seedDatabase: { perks: [] } });
    if (previous !== undefined) process.env.SUPABASE_URL = previous;
    assert.deepEqual(ids(await restored.listPerks()), orderedIds);
    const added = await request("/api/admin/perks", { method: "POST", cookie, body: { title: "Newest perk" } }).then((res) => res.json());
    assert.deepEqual(ids(added.perks), [added.perk.id, ...orderedIds]);
    assert.equal((await request("/api/admin/perks/reorder", { method: "POST", cookie, body: { ids: orderedIds } })).status, 409);
  } finally { await server.close(); }
});

function supabaseDb() {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SECRET_KEY = "test-key";
  const db = createDatabase({ rootDir: "/tmp", seedDatabase: { perks: [{ id: "seed", title: "Seed perk" }] } });
  if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
  if (previous.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previous.key;
  return db;
}

test("Supabase orders reads explicitly and saves all positions in one verified RPC", async (t) => {
  const db = supabaseDb();
  const calls = [];
  const rows = [{ id: "second", title: "Second", sort_order: 0 }, { id: "first", title: "First", sort_order: 1 }];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response(JSON.stringify(rows));
  });
  assert.deepEqual(ids(await db.reorderPerks(["second", "first"])), ["second", "first"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/rest/v1/rpc/reorder_vip_perks");
  assert.deepEqual(JSON.parse(calls[0].options.body), { perk_ids: ["second", "first"] });
  const loaded = await db.listPerks({ visibleOnly: true });
  assert.equal(loaded[1].sortOrder, 1);
  assert.equal(calls[1].url.searchParams.get("order"), "sort_order.asc,created_at.desc,id.asc");
  assert.equal(calls[1].url.searchParams.get("visible"), "eq.true");
});

test("an unapplied migration keeps real perks readable, never replacing them with seed perks", async (t) => {
  const db = supabaseDb();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url); calls.push(parsed);
    return parsed.searchParams.get("order").startsWith("sort_order")
      ? new Response(JSON.stringify({ message: "column vip_perks.sort_order does not exist" }), { status: 400 })
      : new Response(JSON.stringify([{ id: "real", title: "Real perk" }]));
  });
  assert.deepEqual(ids(await db.listPerks({ visibleOnly: true })), ["real"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("visible"), "eq.true");
  assert.equal(calls[1].searchParams.get("order"), "created_at.desc");
});

test("Supabase stale orders, missing migrations and unconfirmed saves cannot report success", async (t) => {
  const db = supabaseDb();
  let status = 400;
  let payload = { message: "PERK_ORDER_CHANGED" };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload), { status }));
  await assert.rejects(db.reorderPerks(["one"]), { status: 409 });
  status = 404; payload = { message: "reorder_vip_perks not in schema cache" };
  await assert.rejects(db.reorderPerks(["one"]), { status: 503 });
  status = 200; payload = [];
  await assert.rejects(db.reorderPerks(["one"]), /could not be verified/);
  payload = [{ id: "wrong" }];
  await assert.rejects(db.reorderPerks(["one"]), /could not be verified/);
});
