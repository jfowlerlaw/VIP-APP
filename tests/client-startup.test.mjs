import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const member = { id: "member-a", name: "Avery Mitchell", email: "avery@example.com", joined: "2024" };
const feedbackType = "App feedback / bug report";

function element() {
  const classes = new Set();
  return {
    dataset: {}, attributes: {}, listeners: {}, children: [], hidden: false, textContent: "", value: "", style: { fontSize: "" },
    classList: { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name),
      toggle: (name, selected) => selected ? classes.add(name) : classes.delete(name) },
    setAttribute(name, value) { this.attributes[name] = value; if (name === "hidden") this.hidden = true; },
    removeAttribute(name) { delete this.attributes[name]; if (name === "hidden") this.hidden = false; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    focus() { this.focused = true; },
  };
}

function client(t, fetch, { native = false, cardNameWidth = null, cardNameHeight = 70 } = {}) {
  const elements = Object.fromEntries([".app-screen", "[data-app-loader]", "[data-launch-loading]", "[data-launch-error]",
    "[data-retry-launch]", "[data-launch-error-title]", "[data-launch-error-message]", "[data-auth-screen]", "[data-app-version]",
    "[data-unread-count]", "[data-inbox-summary]", "[data-mark-all-read]", "#view-title", "[data-refresh-inbox]",
    "[data-notification-delete-dialog]", "[data-confirm-notification-delete]", "[data-cancel-notification-delete]",
    "[data-notification-delete-title]", "[data-notification-delete-error]"].map((key) => [key, element()]));
  if (cardNameWidth !== null) {
    const name = element();
    const area = element();
    area.clientWidth = cardNameWidth;
    area.clientHeight = cardNameHeight;
    name.parentElement = area;
    Object.defineProperty(name, "clientWidth", { get: () => Math.floor(area.clientWidth *
      (name.classList.contains("is-stacked") ? 25 / 32 : 1)) });
    Object.defineProperty(name, "scrollWidth", { get: () => {
      const font = Number.parseFloat(name.style.fontSize || "14");
      const parts = name.classList.contains("is-stacked") ? name.textContent.split(/\s+|(?<=-)/) : [name.textContent];
      const longest = Math.max(...parts.map((word) => word.length));
      return Math.max(name.clientWidth, Math.ceil(longest * font * 0.6));
    } });
    Object.defineProperty(name, "scrollHeight", { get: () => {
      const font = Number.parseFloat(name.style.fontSize || "14");
      const lines = name.classList.contains("is-stacked") ? name.textContent.split("\n").reduce((count, line) => count +
        Math.max(1, Math.ceil(line.length * font * 0.6 / Math.max(1, name.clientWidth))), 0) : 1;
      return Math.ceil(lines * font * 1.18);
    } });
    elements[".etched-name"] = name;
    elements[".card-name-area"] = area;
  }
  const deleteDialog = elements["[data-notification-delete-dialog]"];
  deleteDialog.showModal = () => { deleteDialog.open = true; };
  deleteDialog.close = () => { deleteDialog.open = false; deleteDialog.listeners.close?.(); };
  deleteDialog.querySelector = (selector) => elements[selector] || null;
  deleteDialog.querySelectorAll = () => [elements["[data-confirm-notification-delete]"], elements["[data-cancel-notification-delete]"]];
  const targets = ["card", "perks", "events", "notifications", "concierge", "profile"];
  const nav = targets.map((target) => {
    const item = element();
    item.dataset.viewTarget = target;
    item.dataset.title = target === "notifications" ? "Inbox" : target;
    elements[`[data-view-target="${target}"]`] = item;
    return item;
  });
  const views = targets.map((target) => {
    const view = element();
    view.id = `view-${target}`;
    elements[`#view-${target}`] = view;
    return view;
  });
  const form = element();
  const fields = Object.fromEntries(["select", "textarea", "[data-request-phone]", "[data-request-status]", "button[type='submit']", "[data-feedback-details]"].map((key) => [key, element()]));
  form.querySelector = (selector) => fields[selector] || null;
  form.reset = () => { fields.select.value = ""; fields.textarea.value = ""; };
  elements[".app-screen"].children = [elements["[data-app-loader]"], elements["[data-auth-screen]"]];
  const storage = new Map([["jcm-vip-session", "saved-session"]]);
  const timers = new Set();
  const listeners = {};
  const context = vm.createContext({
    AbortController, TypeError, URL, console,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    navigator: { onLine: true },
    document: {
      documentElement: { dataset: {}, classList: element().classList },
      querySelector: (selector) => elements[selector] || null,
      querySelectorAll: (selector) => ({ "[data-concierge-form]": [form], "[data-view-target]": nav, ".view": views,
        "[data-unread-count]": [elements["[data-unread-count]"]] })[selector] || [],
      addEventListener() {},
    },
    window: {
      location: { protocol: native ? "capacitor:" : "http:" },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      getComputedStyle: () => ({ fontSize: "14px" }),
      addEventListener: (name, listener) => { listeners[name] = listener; },
      setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timers.add(timer); return timer; },
      clearTimeout,
    },
    fetch,
  });
  t.after(() => timers.forEach(clearTimeout));
  vm.runInContext(source, context);
  return { context, elements, storage, listeners, fields, form, run: (code) => vm.runInContext(code, context) };
}

function success(path) {
  return new Response(JSON.stringify(path.endsWith("/me") ? { member } : { events: [], perks: [], notifications: [] }));
}

test("card names stack only when too wide and retain every character within the available space", (t) => {
  const c = client(t, success, { cardNameWidth: 120 });
  const name = c.elements[".etched-name"];
  const area = c.elements[".card-name-area"];
  for (const fullName of ["Josh Fowler", "Alexandria Catherine Montgomery-Sutherland", "W".repeat(200), ""]) {
    c.context.fullName = fullName;
    c.run("updateMemberName(fullName)");
    assert.equal(name.textContent.replace(/\s+/g, " "), fullName || "VIP Member");
    assert.ok(name.scrollWidth <= name.clientWidth);
    assert.ok(name.scrollHeight <= area.clientHeight);
  }
  for (const fullName of ["Josh Fowler", "Avery Mitchell", "VIP Member"]) {
    c.context.fullName = fullName;
    c.run("updateMemberName(fullName)");
    assert.equal(name.textContent, fullName);
    assert.equal(name.classList.contains("is-stacked"), false);
    assert.equal(name.style.fontSize, "");
  }
  c.run('updateMemberName("Alexandria Catherine Montgomery-Sutherland")');
  assert.equal(name.classList.contains("is-stacked"), true);
  assert.equal(name.textContent, "Alexandria Catherine\nMontgomery-Sutherland");
});

test("stacked names preserve known compound surnames, custom names, and single-word names", (t) => {
  const c = client(t, success, { cardNameWidth: 120 });
  c.run('activeMember = { firstName: "Juan Carlos", lastName: "de la Cruz" }');
  c.run('updateMemberName("Juan Carlos de la Cruz")');
  assert.equal(c.elements[".etched-name"].textContent, "Juan Carlos\nde la Cruz");
  c.run('updateMemberName("Captain Moe")');
  assert.equal(c.elements[".etched-name"].textContent, "Captain Moe");
  c.run('updateMemberName("Prince")');
  assert.equal(c.elements[".etched-name"].textContent, "Prince");
});

test("stacked names shrink for height even when both lines fit horizontally", (t) => {
  const c = client(t, success, { cardNameWidth: 90, cardNameHeight: 25 });
  c.run('updateMemberName("Josh Fowler")');
  const name = c.elements[".etched-name"];
  assert.equal(name.textContent, "Josh\nFowler");
  assert.ok(Number.parseFloat(name.style.fontSize) < 14);
  assert.ok(name.scrollHeight <= 25);
  assert.ok(name.scrollWidth <= name.clientWidth);
});

test("card names refit after hidden profile edits, returning to Card, and container resizing", (t) => {
  const c = client(t, success, { cardNameWidth: 0 });
  const name = c.elements[".etched-name"];
  const area = c.elements[".card-name-area"];
  c.run('updateMemberName("Alexandria Catherine Montgomery-Sutherland")');
  assert.equal(name.style.fontSize, "");
  assert.equal(name.classList.contains("is-stacked"), false);
  area.clientWidth = 200;
  c.run('activateView("card", "Card")');
  assert.equal(name.classList.contains("is-stacked"), true);
  assert.ok(name.scrollWidth <= name.clientWidth);
  assert.ok(name.scrollHeight <= area.clientHeight);
  let onResize;
  c.context.window.ResizeObserver = class {
    constructor(callback) { onResize = callback; }
    observe(target) { assert.equal(target, name.parentElement); }
  };
  c.run("setupCardNameFitting()");
  const oldSize = Number.parseFloat(name.style.fontSize || "14");
  area.clientWidth = 50;
  onResize();
  assert.ok(Number.parseFloat(name.style.fontSize) < oldSize);
  assert.ok(name.scrollWidth <= name.clientWidth);
  assert.ok(name.scrollHeight <= area.clientHeight);
  area.clientWidth = 500;
  c.listeners.resize();
  assert.equal(name.style.fontSize, "");
  assert.equal(name.textContent, "Alexandria Catherine Montgomery-Sutherland");
  assert.equal(name.classList.contains("is-stacked"), false);
  area.clientWidth = 120;
  onResize();
  assert.equal(name.classList.contains("is-stacked"), true);
  assert.equal(name.textContent, "Alexandria Catherine\nMontgomery-Sutherland");
  assert.ok(name.scrollWidth <= name.clientWidth);
  assert.ok(name.scrollHeight <= area.clientHeight);
});

test("startup preserves saved login through server/session failures and retry restores the member", async (t) => {
  for (const failAt of ["/api/health", "/api/me"]) {
    let failed = true;
    const c = client(t, async (path) => failed && path === failAt ? new Response("{}", { status: 503 }) : success(path));
    await c.run("bootBetaApi()");
    assert.equal(c.storage.get("jcm-vip-session"), "saved-session");
    assert.equal(c.elements["[data-app-loader]"].dataset.state, "error");
    assert.equal(c.elements["[data-launch-error]"].hidden, false);
    assert.equal(c.elements["[data-auth-screen]"].inert, true);
    failed = false;
    await c.elements["[data-retry-launch]"].listeners.click();
    assert.equal(c.elements["[data-app-loader]"].dataset.state, "ready");
    assert.equal(c.elements["[data-auth-screen]"].hidden, true);
    assert.equal(c.elements["[data-auth-screen]"].inert, false);
    assert.equal(c.storage.get("jcm-vip-session"), "saved-session");
  }
});

test("confirmed expired sessions clear login while offline sessions remain behind retry screen", async (t) => {
  const expired = client(t, async (path) => path === "/api/me" ? new Response("{}", { status: 401 }) : success(path));
  await expired.run("bootBetaApi()");
  assert.equal(expired.storage.has("jcm-vip-session"), false);
  assert.equal(expired.elements["[data-app-loader]"].dataset.state, "ready");
  assert.equal(expired.elements["[data-auth-screen]"].hidden, false);
  const offline = client(t, async () => { throw new TypeError("Failed to fetch"); });
  offline.context.navigator.onLine = false;
  await offline.run("bootBetaApi()");
  assert.equal(offline.elements["[data-launch-error-title]"].textContent, "You're offline");
  assert.equal(offline.storage.get("jcm-vip-session"), "saved-session");
});

test("request timeout covers both connection and response body, without resending mutations", async (t) => {
  for (const phase of ["connection", "body"]) {
    let calls = 0;
    const c = client(t, async (_path, { signal }) => {
      calls++;
      const pending = () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
      return phase === "connection" ? pending() : { ok: true, json: pending };
    });
    await assert.rejects(c.run('apiRequest("/api/requests", { method: "POST", timeoutMs: 5 })'), (error) => error.code === "TIMEOUT" && error.message.includes("may have gone through"));
    assert.equal(calls, 1);
  }
});

test("repeated launch retries share a single in-flight session check", async (t) => {
  let resolveHealth;
  let checks = 0;
  const c = client(t, (path) => {
    if (path === "/api/health") {
      checks++;
      return new Promise((resolve) => { resolveHealth = resolve; });
    }
    return Promise.resolve(success(path));
  });
  const first = c.run("bootBetaApi()");
  await c.run("bootBetaApi()");
  assert.equal(checks, 1);
  resolveHealth(success("/api/health"));
  await first;
});

test("native build details update Profile and are attached only to feedback submissions", async (t) => {
  const submissions = [];
  const c = client(t, async (path, options) => {
    if (path.endsWith("/requests")) {
      submissions.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ email: { status: "sent" } }));
    }
    return success(path);
  }, { native: true });
  await c.run("bootBetaApi()");
  c.context.window.__VIP_APP_INFO__ = { version: "1.0", build: "7", osVersion: "26.6" };
  c.listeners["vip:app-info"]();
  assert.equal(c.elements["[data-app-version]"].textContent, "Version 1.0 (Build 7)");
  for (const type of [feedbackType, "Other"]) {
    c.fields.select.value = type;
    c.fields.select.listeners.change();
    assert.equal(c.fields["[data-feedback-details]"].hidden, type !== feedbackType);
    c.fields.textarea.value = "The event link won't open.";
    c.fields["[data-request-phone]"].value = "4075550188";
    await c.form.listeners.submit({ preventDefault() {} });
  }
  assert.deepEqual(submissions[0].appInfo, { version: "1.0", build: "7", platform: "ios", osVersion: "26.6" });
  assert.equal(submissions[1].appInfo, undefined);
  assert.equal(c.fields["[data-feedback-details]"].hidden, true);
  const web = client(t, async (path) => success(path));
  web.run("updateAppVersion()");
  assert.equal(web.elements["[data-app-version]"].textContent, "Web portal");
});

test("Inbox tab selects its view and unread badge follows reads, mark-all, large counts, and logout", async (t) => {
  let failRead = false;
  const notices = [{ id: "first", readAt: null }, { id: "second", readAt: null }, { id: "old", readAt: "2026-10-21T12:00:00Z" }];
  const c = client(t, async (path) => {
    if (path === "/api/notifications") return new Response(JSON.stringify({ notifications: notices }));
    if (path.endsWith("/read") && failRead) return new Response("{}", { status: 503 });
    return success(path);
  });
  await c.run("bootBetaApi()");
  await c.run("loadInbox()");
  const tab = c.elements['[data-view-target="notifications"]'];
  const badge = c.elements["[data-unread-count]"];
  assert.equal(badge.textContent, "2");
  assert.equal(badge.hidden, false);
  assert.equal(tab.attributes["aria-label"], "Inbox, 2 unread messages");
  tab.listeners.click();
  await c.run("loadInbox()");
  assert.equal(c.elements["#view-notifications"].classList.contains("is-active"), true);
  assert.equal(tab.attributes["aria-current"], "page");
  assert.equal(c.elements["#view-title"].textContent, "Inbox");
  const readState = element();
  c.context.testMessage = { ...element(), querySelector: () => readState };
  failRead = true;
  await c.run("markNotificationRead(inboxNotifications[0], testMessage)");
  assert.equal(badge.textContent, "2");
  failRead = false;
  await c.run("markNotificationRead(inboxNotifications[0], testMessage)");
  assert.equal(badge.textContent, "1");
  assert.equal(tab.attributes["aria-label"], "Inbox, 1 unread message");
  await c.elements["[data-mark-all-read]"].listeners.click();
  assert.equal(badge.hidden, true);
  assert.equal(tab.attributes["aria-label"], "Inbox");
  assert.equal(c.elements["[data-inbox-summary]"].textContent, "You're all caught up");
  c.run("inboxNotifications = Array.from({ length: 125 }, () => ({ readAt: null })); updateInboxBadges()");
  assert.equal(badge.textContent, "99+");
  assert.equal(tab.attributes["aria-label"], "Inbox, 125 unread messages");
  c.run("resetMemberAuth()");
  assert.equal(badge.hidden, true);
  assert.equal(tab.attributes["aria-current"], undefined);
  assert.equal(c.elements['[data-view-target="card"]'].attributes["aria-current"], "page");
});

test("deletion requires confirmation, preserves messages on failure, and updates unread count on success", async (t) => {
  let fail = true;
  let deleted = false;
  let calls = 0;
  const notices = [{ id: "old", title: "Old message", readAt: null }, { id: "keep", title: "Keep me", readAt: "2026-10-21T12:00:00Z" }];
  const c = client(t, async (path, options) => {
    if (options.method === "DELETE") {
      calls++;
      if (fail) return new Response(JSON.stringify({ message: "Please try again." }), { status: 503 });
      deleted = true;
    }
    if (path === "/api/notifications") return new Response(JSON.stringify({ notifications: notices.filter((item) => !deleted || item.id !== "old") }));
    return success(path);
  });
  await c.run("bootBetaApi()");
  await c.run("loadInbox()");
  const dialog = c.elements["[data-notification-delete-dialog]"];
  const badge = c.elements["[data-unread-count]"];
  c.run("requestNotificationDeletion(inboxNotifications[0])");
  assert.equal(dialog.open, true);
  assert.equal(c.elements["[data-notification-delete-title]"].textContent, "Old message");
  c.elements["[data-cancel-notification-delete]"].listeners.click();
  await c.run("deleteSelectedNotification()");
  assert.equal(calls, 0);
  c.run("requestNotificationDeletion(inboxNotifications[0])");
  await c.elements["[data-confirm-notification-delete]"].listeners.click();
  assert.equal(dialog.open, true);
  assert.equal(badge.textContent, "1");
  assert.equal(c.elements["[data-notification-delete-error]"].textContent, "Please try again.");
  assert.equal(c.elements["[data-confirm-notification-delete]"].disabled, false);
  fail = false;
  await c.elements["[data-confirm-notification-delete]"].listeners.click();
  assert.equal(dialog.open, false);
  assert.equal(badge.hidden, true);
  assert.equal(c.elements["[data-refresh-inbox]"].focused, true);
  await c.run("loadInbox()");
  assert.equal(c.run("inboxNotifications.length"), 1);
  assert.equal(c.run("inboxNotifications[0].id"), "keep");
});

test("a stale inbox refresh cannot reinsert a message after deletion", async (t) => {
  let waitForRefresh = false;
  let resolveRefresh;
  const payload = { notifications: [{ id: "old", title: "Old message", readAt: null }] };
  const c = client(t, async (path) => {
    if (path === "/api/notifications") {
      if (waitForRefresh) return new Promise((resolve) => { resolveRefresh = resolve; });
      return new Response(JSON.stringify(payload));
    }
    return success(path);
  });
  await c.run("bootBetaApi()");
  await c.run("loadInbox()");
  waitForRefresh = true;
  const refresh = c.run("loadInbox()");
  c.run("requestNotificationDeletion(inboxNotifications[0])");
  await c.run("deleteSelectedNotification()");
  resolveRefresh(new Response(JSON.stringify(payload)));
  await refresh;
  assert.equal(c.run("inboxNotifications.length"), 0);
  assert.equal(c.elements["[data-unread-count]"].hidden, true);
});
