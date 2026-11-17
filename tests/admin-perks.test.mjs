import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../admin.js", import.meta.url), "utf8");

function element(value = "") {
  return { value, dataset: {}, hidden: false, disabled: false, required: false, textContent: "", listeners: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {},
    addEventListener(name, handler) { this.listeners[name] = handler; }, querySelectorAll() { return []; }, focus() {} };
}

function admin(t, fetch = async () => new Response("{}")) {
  const fields = Object.fromEntries(["perkId", "title", "description", "note", "icon", "accent", "buttonLabel", "actionUrl",
    "actionMessage", "visible", "actionType", "emailTo", "emailSubject", "emailBody"].map((name) => [name, element()]));
  fields.actionType.value = "link";
  fields.visible.type = "checkbox"; fields.visible.checked = true;
  const form = element(); form.elements = fields;
  form.reset = () => { for (const input of Object.values(fields)) input.value = ""; };
  const groups = Object.fromEntries([["[data-perk-link-fields]", [fields.actionUrl]],
    ["[data-perk-email-fields]", [fields.emailTo, fields.emailSubject, fields.emailBody]],
    ["[data-perk-message-fields]", [fields.actionMessage]]].map(([key, inputs]) => {
    const group = element(); group.querySelectorAll = () => inputs; return [key, group];
  }));
  const submit = element();
  form.querySelector = (selector) => groups[selector] || (selector === "[data-perk-submit]" ? submit : fields.title);
  const list = element();
  const toast = element();
  const elements = { "[data-perk-form]": form, "[data-perk-list]": list, ".toast": toast,
    "[data-perk-action-type]": fields.actionType, "[data-event-start-label]": element(), "[data-event-end-label]": element() };
  const timers = [];
  const context = vm.createContext({ console, URL, URLSearchParams, fetch,
    EventLinkImporter: class {},
    FormData: class { constructor(form) { this.fields = form.elements; } get(name) {
      const input = this.fields[name];
      return !input || input.disabled ? null : input.type === "checkbox" ? input.checked ? "on" : null : input.value;
    } },
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { querySelector: (key) => elements[key] || null, querySelectorAll: () => [], documentElement: { dataset: {} } },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, clearTimeout,
      setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timers.push(timer); return timer; } },
  });
  vm.runInContext(source, context);
  t.after(() => timers.forEach(clearTimeout));
  return { context, fields, form, groups, submit, list, toast, run: (code) => vm.runInContext(code, context) };
}

test("admin email actions encode drafts and round-trip existing recipients and headers", (t) => {
  const a = admin(t);
  a.run("resetPerkForm()");
  a.fields.actionType.value = "email";
  a.fields.emailTo.value = "vip+perks@example.com";
  a.fields.emailSubject.value = "VIP gift & questions + details";
  a.fields.emailBody.value = "Hello VIP team,\nI'd like the gift.";
  a.run("syncPerkActionFields()");
  const payload = a.run("perkPayloadFromForm(perkForm)");
  const url = new URL(payload.actionUrl);
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, "vip+perks@example.com");
  assert.equal(url.searchParams.get("subject"), "VIP gift & questions + details");
  assert.equal(url.searchParams.get("body"), "Hello VIP team,\r\nI'd like the gift.");
  assert.ok(payload.actionUrl.includes("%20"));
  assert.equal(payload.actionMessage, "");
  assert.equal(a.fields.actionUrl.disabled, true);
  assert.equal(a.fields.emailTo.required, true);
  a.context.perk = { title: "Email perk", actionUrl: payload.actionUrl + "&cc=team%2Bvip%40example.com" };
  a.run("editPerk(perk)");
  assert.equal(a.fields.actionType.value, "email");
  assert.equal(a.fields.emailTo.value, "vip+perks@example.com");
  const edited = new URL(a.run("perkPayloadFromForm(perkForm)").actionUrl);
  assert.equal(edited.searchParams.get("cc"), "team+vip@example.com");
  assert.equal(edited.searchParams.get("body"), url.searchParams.get("body"));
  a.context.perk = { title: "Unusual email link", actionUrl: "mailto:vip%ZZ@example.com" };
  a.run("editPerk(perk)");
  assert.equal(a.fields.actionType.value, "link");
  assert.equal(a.fields.actionUrl.value, "mailto:vip%ZZ@example.com");
});

test("switching perk actions excludes hidden fields and reset restores ordinary link editing", (t) => {
  const a = admin(t);
  a.run("resetPerkForm()");
  a.fields.actionType.value = "message";
  a.fields.actionMessage.value = "Ask at the front desk.";
  a.run("syncPerkActionFields()");
  const payload = a.run("perkPayloadFromForm(perkForm)");
  assert.equal(payload.actionUrl, "");
  assert.equal(payload.actionMessage, "Ask at the front desk.");
  assert.equal(a.fields.emailTo.disabled, true);
  assert.equal(a.fields.emailTo.required, false);
  assert.equal(a.groups["[data-perk-message-fields]"].hidden, false);
  a.run("resetPerkForm()");
  assert.equal(a.fields.actionType.value, "link");
  assert.equal(a.fields.actionUrl.disabled, false);
  assert.equal(a.fields.actionUrl.required, true);
  assert.equal(a.fields.emailSubject.value, "");
  assert.equal(a.form.dataset.emailUrl, undefined);
  assert.match(a.run("perkPayloadFromForm(perkForm)").actionUrl, /^https:/);
});

test("perk moves wait for confirmation, block duplicates and retain the last saved order on failure", async (t) => {
  const calls = [];
  let resolve;
  const a = admin(t, (path, options) => { calls.push({ path, options }); return new Promise((done) => { resolve = done; }); });
  a.run('adminApiReady = true; currentPerks = [{id:"a"},{id:"b"},{id:"c"}]; renderPerks = (items) => { currentPerks = [...items]; }');
  const moving = a.run('movePerk("b", -1)');
  await a.run('movePerk("b", -1)');
  assert.equal(calls.length, 1);
  assert.equal(a.submit.disabled, true);
  assert.deepEqual(JSON.parse(calls[0].options.body), { ids: ["b", "a", "c"] });
  assert.equal(a.run('currentPerks.map(p => p.id).join(",")'), "a,b,c");
  resolve(new Response(JSON.stringify({ perks: [{ id: "b" }, { id: "a" }, { id: "c" }] })));
  await moving;
  assert.equal(a.run('currentPerks.map(p => p.id).join(",")'), "b,a,c");
  assert.equal(a.submit.disabled, false);
  const failed = a.run('movePerk("a", 1)');
  resolve(new Response(JSON.stringify({ message: "Could not save" }), { status: 503 }));
  await failed;
  assert.equal(a.run('currentPerks.map(p => p.id).join(",")'), "b,a,c");
  assert.equal(a.toast.textContent, "Could not save");
  assert.equal(a.submit.disabled, false);
  const count = calls.length;
  await a.run('movePerk("b", -1); movePerk("c", 1); movePerk("missing", 1)');
  assert.equal(calls.length, count);
});
