import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createDatabase } from "../database.mjs";

function database() {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  try {
    return createDatabase({ rootDir: tmpdir(), seedDatabase: {} });
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
}

test("Supabase inbox excludes saved deletions on every reload and across database instances", async (t) => {
  const receipts = new Map();
  const source = [{ id: "old-message", title: "Old update", body: "Member news", action_view: "none",
    member_id: null, created_at: "2026-10-22T18:00:00Z" }];
  t.mock.method(globalThis, "fetch", async (value, options) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/vip_notification_reads")) {
      const body = JSON.parse(options.body);
      const key = `${body.member_id}:${body.notification_id}`;
      const stored = { read_at: "2026-10-21T12:00:00Z", ...receipts.get(key), ...body };
      receipts.set(key, stored);
      return new Response(JSON.stringify([stored]), { status: 201 });
    }
    if (url.searchParams.get("select") === "id") return new Response(JSON.stringify([{ id: "old-message" }]));
    // Plain PostgREST equality values are literal, unlike values inside OR/IN.
    const scopedMember = url.searchParams.get("vip_notification_reads.member_id").slice(3);
    return new Response(JSON.stringify(source.map((row) => ({ ...row,
      vip_notification_reads: [...receipts.values()].filter((receipt) =>
        receipt.notification_id === row.id && receipt.member_id === scopedMember),
    }))));
  });
  const db = database();
  assert.equal((await db.listNotifications("member-a")).length, 1);
  assert.equal(await db.deleteNotification("member-a", "old-message"), true);
  for (const instance of [db, db, database()]) {
    assert.deepEqual(await instance.listNotifications("member-a"), []);
    assert.equal((await instance.listNotifications("member-b"))[0].id, "old-message");
  }
  assert.equal(receipts.get("member-a:old-message").read_at, "2026-10-21T12:00:00Z");
  assert.equal(source.length, 1);
});

test("Supabase equality filters preserve member-ID punctuation without injecting query parameters", async (t) => {
  const memberId = 'member,("quoted")\\&vip_notification_reads.member_id=eq.other';
  t.mock.method(globalThis, "fetch", async (value) => {
    const params = new URL(value).searchParams;
    assert.deepEqual(params.getAll("vip_notification_reads.member_id"), [`eq.${memberId}`]);
    const scopedMember = params.get("vip_notification_reads.member_id").slice(3);
    const rows = [
      { id: "read", read_at: "2026-10-22T12:00:00Z", deleted_at: null },
      { id: "deleted", read_at: "2026-10-22T12:00:00Z", deleted_at: "2026-10-22T18:00:00Z" },
    ];
    return new Response(JSON.stringify(rows.map((row) => ({ id: row.id, member_id: null,
      vip_notification_reads: scopedMember === memberId ? [{ member_id: memberId, ...row }] : [],
    }))));
  });
  const inbox = await database().listNotifications(memberId);
  assert.deepEqual(inbox.map((item) => item.id), ["read"]);
  assert.equal(inbox[0].readAt, "2026-10-22T12:00:00Z");
});

test("Supabase fills the inbox past whole pages of deletions without applying another member's receipts", async (t) => {
  const source = Array.from({ length: 450 }, (_, index) => ({ id: `notice-${index}`, title: "Update",
    member_id: null, created_at: "2026-10-22T18:00:00Z", vip_notification_reads: [
      { member_id: "member-b", read_at: "2026-10-21T12:00:00Z", deleted_at: "2026-10-22T18:00:00Z" },
      ...(index < 250 ? [{ member_id: "member-a", read_at: "2026-10-21T12:00:00Z", deleted_at: "2026-10-22T18:00:00Z" }] : []),
    ] }));
  const offsets = [];
  t.mock.method(globalThis, "fetch", async (value) => {
    const params = new URL(value).searchParams;
    const offset = Number(params.get("offset") || 0);
    offsets.push(offset);
    return new Response(JSON.stringify(source.slice(offset, offset + Number(params.get("limit")))));
  });
  const inbox = await database().listNotifications("member-a");
  assert.equal(inbox.length, 200);
  assert.equal(inbox[0].id, "notice-250");
  assert.equal(inbox.at(-1).id, "notice-449");
  assert.ok(inbox.every((item) => item.readAt === null));
  assert.deepEqual(offsets, [0, 200, 400]);
});

test("Supabase deletion rejects an unconfirmed write instead of reporting success", async (t) => {
  let savedRows = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (options.method === "POST") return new Response(JSON.stringify(savedRows), { status: 201 });
    return new Response(JSON.stringify([{ id: "old-message" }]));
  });
  const db = database();
  for (const rows of [[], null,
    [{ notification_id: "old-message", member_id: "member-b", deleted_at: "2026-10-22T18:00:00Z" }],
    [{ notification_id: "other-message", member_id: "member-a", deleted_at: "2026-10-22T18:00:00Z" }],
    [{ notification_id: "old-message", member_id: "member-a", deleted_at: null }]]) {
    savedRows = rows;
    await assert.rejects(db.deleteNotification("member-a", "old-message"), /deletion could not be verified/i);
  }
});
