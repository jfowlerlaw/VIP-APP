import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const member = { name: "Avery Mitchell", email: "avery@example.com", joined: "2024" };
const feedbackType = "App feedback / bug report";

function element() {
  const classes = new Set();
  return {
    dataset: {}, attributes: {}, listeners: {}, children: [], hidden: false, textContent: "", value: "",
    classList: { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name) },
    setAttribute(name, value) { this.attributes[name] = value; if (name === "hidden") this.hidden = true; },
    removeAttribute(name) { delete this.attributes[name]; if (name === "hidden") this.hidden = false; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    focus() { this.focused = true; },
  };
}

function client(t, fetch, { native = false } = {}) {
  const elements = Object.fromEntries([".app-screen", "[data-app-loader]", "[data-launch-loading]", "[data-launch-error]",
    "[data-retry-launch]", "[data-launch-error-title]", "[data-launch-error-message]", "[data-auth-screen]", "[data-app-version]"].map((key) => [key, element()]));
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
      querySelectorAll: (selector) => selector === "[data-concierge-form]" ? [form] : [],
      addEventListener() {},
    },
    window: {
      location: { protocol: native ? "capacitor:" : "http:" },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
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
