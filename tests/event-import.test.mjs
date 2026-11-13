import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { publicEventUrl, isPublicAddress, resolvePublicAddress, parseEventPage, fetchEventPage, importEvent } from "../event-import.mjs";
import { startTestServer } from "./test-server.mjs";

const pageUrl = "https://tickets.acme.com/shows/comedy";
const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
const markup = (event) => `<script type="application/ld+json">${JSON.stringify(event)}</script>`;
const sample = { '@type': 'ComedyEvent', name: 'VIP Comedy Night', description: '<p>Join us<br>for laughs &amp; more.</p>',
  startDate: '2026-11-19T19:00:00-05:00', endDate: '2026-11-19T21:00:00-05:00', image: '/poster.jpg',
  location: { '@type': 'Place', name: 'Comedy Club', address: { streetAddress: '123 Main St', addressLocality: 'Orlando', addressRegion: 'FL', postalCode: '32819' } } };

function fakeRequest(responses, calls = []) {
  return (url, options, callback) => {
    calls.push({ url: url.href, options });
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const response = responses.shift();
      if (!response) return;
      const stream = new PassThrough();
      stream.statusCode = response.status || 200;
      stream.headers = { 'content-type': 'text/html', ...response.headers };
      callback(stream);
      if (!stream.destroyed) stream.end(response.body ?? markup(sample));
    });
    return req;
  };
}

test("event importer reads structured event details, graphic, venue and exact dates", () => {
  const event = parseEventPage(markup(sample), pageUrl);
  assert.equal(event.title, sample.name);
  assert.equal(event.copy, 'Join us\nfor laughs & more.');
  assert.equal(event.image, 'https://tickets.acme.com/poster.jpg');
  assert.equal(event.startsAt, '2026-11-20T00:00:00.000Z');
  assert.equal(event.endsAt, '2026-11-20T02:00:00.000Z');
  assert.equal(event.dateLabel, 'Nov 19, 2026');
  assert.equal(event.city, 'Orlando');
  assert.equal(event.address, '123 Main St, Orlando, FL, 32819');
});

test("event importer follows graph references and selects the event matching the page", () => {
  const html = markup({ '@graph': [ { ...sample, name: 'Wrong Show', url: '/shows/another' },
    { ...sample, url: pageUrl, image: { '@id': '#image' }, location: { '@id': '#venue' } },
    { '@id': '#image', '@type': 'ImageObject', contentUrl: '//cdn.acme.com/image.jpg' },
    { '@id': '#venue', name: 'The Venue', address: { '@id': '#address' } },
    { '@id': '#address', streetAddress: '4 Main St', addressLocality: 'Tampa' } ] });
  const event = parseEventPage(html, pageUrl);
  assert.equal(event.title, sample.name);
  assert.equal(event.image, 'https://cdn.acme.com/image.jpg');
  assert.equal(event.location, 'The Venue');
  assert.equal(event.city, 'Tampa');
});

test("fallback metadata is plain text and never treats publication dates as event dates", () => {
  const event = parseEventPage(`<title>Fallback</title><meta property="og:title" content="A &amp; B">
    <meta property="og:description" content="&lt;script&gt;bad()&lt;/script&gt;Good night">
    <meta property="og:image" content="/graphic.png"><meta property="article:published_time" content="2026-11-19T19:00:00Z">
    <script type="application/ld+json">broken JSON</script>`, pageUrl);
  assert.equal(event.title, 'A & B');
  assert.equal(event.copy, 'Good night');
  assert.equal(event.startsAt, null);
  assert.equal(event.dateLabel, '');
});

test("microdata imports event fields without requiring JSON-LD", () => {
  const event = parseEventPage(`<div itemscope itemtype="https://schema.org/MusicEvent"><h1 itemprop="name">Concert</h1>
    <time itemprop="startDate" datetime="2026-11-19T19:00:00-05:00"></time><meta itemprop="endDate" content="2026-11-19T21:00:00-05:00">
    <img itemprop="image" src="/poster.png"><div itemprop="location"><span itemprop="name">The Hall</span>
    <div itemprop="address"><span itemprop="addressLocality">Orlando</span></div></div></div>`, pageUrl);
  assert.equal(event.title, 'Concert');
  assert.equal(event.location, 'The Hall');
  assert.equal(event.city, 'Orlando');
  assert.equal(event.image, 'https://tickets.acme.com/poster.png');
  assert.equal(event.startsAt, '2026-11-20T00:00:00.000Z');
});

test("unknown end times, date-only and offset-less schedules are not guessed", () => {
  for (const dates of [{ startDate: '2026-11-19' }, { startDate: sample.startDate },
    { startDate: '2026-11-19T19:00:00', endDate: '2026-11-19T21:00:00' },
    { startDate: sample.startDate, endDate: '2026-11-19T18:00:00-05:00' }]) {
    const event = parseEventPage(markup({ ...sample, endDate: null, ...dates }), pageUrl);
    assert.equal(event.startsAt, null);
    assert.equal(event.endsAt, null);
    assert.equal(event.dateLabel, 'Nov 19, 2026');
  }
  assert.equal(parseEventPage(markup({ ...sample, startDate: '2026-02-30' }), pageUrl).dateLabel, '');
});

test("multiple unrelated events and malicious graphic URLs cannot silently fill the wrong event", () => {
  const event = parseEventPage(markup([{ ...sample, name: 'One' }, { ...sample, name: 'Two' }]) + '<h1>Calendar</h1>', pageUrl);
  assert.equal(event.title, 'Calendar');
  assert.equal(event.location, '');
  for (const image of ['javascript:alert(1)', 'http://127.0.0.1/pic', 'http://[::1]/pic', 'http://user:pass@acme.com/pic']) {
    assert.equal(parseEventPage(markup({ ...sample, image }), pageUrl).image, '');
  }
});

test("URL validation rejects local, reserved, mapped and alternate numeric addresses", () => {
  for (const url of ['file:///tmp/secret', 'ftp://acme.com/x', 'https://user:pass@acme.com', 'http://acme.com:8000',
    'http://localhost', 'http://a.local', 'http://127.1', 'http://2130706433', 'http://0x7f000001',
    'http://10.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[fc00::1]']) {
    assert.throws(() => publicEventUrl(url), undefined, url);
  }
  for (const address of ['192.168.1.1', '100.64.1.1', '0.0.0.0', '224.0.0.1', '::', '64:ff9b::a00:1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(publicEventUrl(pageUrl).href, pageUrl);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test("mixed DNS answers are rejected before any HTTP request", async () => {
  await assert.rejects(resolvePublicAddress(new URL(pageUrl), async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]), /publicly accessible/);
  let requested = false;
  await assert.rejects(fetchEventPage(pageUrl, { resolve: async () => [{ address: '10.0.0.1', family: 4 }], request: () => { requested = true; } }), /publicly accessible/);
  assert.equal(requested, false);
});

test("requests pin DNS and validate redirects, including private redirect destinations", async () => {
  const calls = [];
  const page = await fetchEventPage(pageUrl, { resolve, request: fakeRequest([{ status: 302, headers: { location: '/new' } }, {}], calls) });
  assert.equal(page.url, 'https://tickets.acme.com/new');
  calls[0].options.lookup('tickets.acme.com', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4); });
  assert.equal(calls[0].options.agent, false);
  await assert.rejects(fetchEventPage(pageUrl, { resolve, request: fakeRequest([{ status: 302, headers: { location: 'http://127.0.0.1' } }]) }), /publicly accessible/);
  await assert.rejects(fetchEventPage(pageUrl, { resolve, request: fakeRequest(Array.from({ length: 5 }, () => ({ status: 302, headers: { location: '/loop' } }))) }), /could not be read/);
});

test("fetching bounds response size, time, content type and HTTP failures", async () => {
  await assert.rejects(fetchEventPage(pageUrl, { resolve, request: fakeRequest([{ body: 'x'.repeat(200) }]), maxBytes: 100 }), /too large/);
  await assert.rejects(fetchEventPage(pageUrl, { resolve, request: fakeRequest([{ headers: { 'content-type': 'image/png' } }]) }), /not a readable/);
  await assert.rejects(fetchEventPage(pageUrl, { resolve, request: fakeRequest([{ status: 403 }]) }), /could not be read/);
  await assert.rejects(fetchEventPage(pageUrl, { resolve, request: fakeRequest([]), timeout: 15 }), /too long/);
  await assert.rejects(fetchEventPage(pageUrl, { resolve: () => new Promise(() => {}), timeout: 15 }), /too long/);
});

test("compressed pages import correctly and decompression cannot bypass the size limit", async () => {
  for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]]) {
    const page = await fetchEventPage(pageUrl, { resolve, request: fakeRequest([{ headers: { 'content-encoding': encoding }, body: compress(markup(sample)) }]) });
    assert.equal(parseEventPage(page.html, pageUrl).title, sample.name);
  }
  await assert.rejects(fetchEventPage(pageUrl, { resolve, maxBytes: 500, request: fakeRequest([{ headers: { 'content-encoding': 'gzip' }, body: gzipSync('x'.repeat(5000)) }]) }), /too large/);
  await assert.rejects(fetchEventPage(pageUrl, { resolve, request: fakeRequest([{ headers: { 'content-encoding': 'gzip' }, body: 'not compressed' }]) }));
});

test("import returns only a reviewable draft and omits a private-hosted image", async () => {
  const result = await importEvent(pageUrl, { resolve, request: fakeRequest([{}]) });
  assert.equal(result.event.title, sample.name);
  assert.match(result.message, /Review before publishing/);
  const imageResolve = async (host) => [{ address: host === 'images.acme.com' ? '10.0.0.1' : '93.184.216.34', family: 4 }];
  const partial = await importEvent(pageUrl, { resolve: imageResolve, request: fakeRequest([{ body: markup({ ...sample, image: 'https://images.acme.com/pic.jpg', endDate: null }) }]) });
  assert.equal(partial.event.image, '');
  assert.match(partial.message, /photo, start\/end times/);
});

test("import API requires admin login and never publishes on import or invalid links", async () => {
  const server = await startTestServer({ eventFixture: true });
  try {
    const post = (path, body, cookie) => fetch(server.origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post('/api/admin/events/import', { url: pageUrl })).status, 401);
    const login = await post('/api/admin/login', { password: 'local-feature-test' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const list = () => fetch(server.origin + '/api/admin/events', { headers: { Cookie: cookie } }).then((res) => res.json());
    const before = await list();
    const invalid = await post('/api/admin/events/import', { url: 'http://127.0.0.1' }, cookie);
    assert.equal(invalid.status, 400);
    const imported = await post('/api/admin/events/import', { url: 'https://events.moevip-demo.com/comedy' }, cookie);
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).event.title, 'VIP Comedy Night');
    assert.deepEqual(await list(), before);
  } finally { await server.close(); }
});

function clientFixture() {
  const element = (name = '') => ({ name, value: '', textContent: '', hidden: false, disabled: false, validity: { valid: true },
    listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, getAttribute(name) { return this[name]; },
    removeAttribute(name) { delete this[name]; }, setAttribute(name, value) { this[name] = value; } });
  const elements = Object.fromEntries(['eventUrl', 'eventName', 'eventCopy', 'image', 'eventDate', 'eventLocation', 'city', 'address', 'startsAt', 'endsAt'].map((name) => [name, element(name)]));
  const controls = Object.fromEntries(['[data-event-import-status]', '[data-import-event]', '[data-event-image-preview]', "button[type='submit']"].map((selector) => [selector, element()]));
  const form = { ...element(), elements, querySelector: (selector) => controls[selector] };
  const pending = [];
  const request = (...args) => new Promise((resolve, reject) => pending.push({ args, resolve, reject }));
  const context = vm.createContext({ AbortController, setTimeout, clearTimeout, Date, Map, Set });
  vm.runInContext(clientCode + '\nglobalThis.Importer = EventLinkImporter;', context);
  const importer = new context.Importer(form, request, () => true);
  const edit = (name, value) => { elements[name].value = value; form.listeners.input({ target: elements[name] }); };
  return { importer, elements, controls, pending, edit };
}
const clientCode = await readFile(new URL('../admin-event-import.js', import.meta.url), 'utf8');

test("client fills fields, keeps manual edits and ignores stale responses", async () => {
  const { importer, elements, pending, edit } = clientFixture();
  elements.eventUrl.value = pageUrl;
  const first = importer.start();
  edit('eventName', 'My VIP Title');
  pending[0].resolve({ event: parseEventPage(markup(sample), pageUrl), message: 'Imported.' });
  await first;
  assert.equal(elements.eventName.value, 'My VIP Title');
  assert.equal(elements.city.value, 'Orlando');
  assert.equal(importer.busy, false);
  const old = importer.start();
  elements.eventUrl.value = 'https://tickets.acme.com/new';
  const fresh = importer.start();
  pending[2].resolve({ event: { city: 'Miami' } }); await fresh;
  pending[1].resolve({ event: { city: 'Wrong city' } }); await old;
  assert.equal(elements.city.value, 'Miami');
});

test("client resets cancel in-flight results and new links clear only auto-filled fields", async () => {
  const { importer, elements, pending, edit } = clientFixture();
  elements.eventUrl.value = pageUrl;
  const initial = importer.start();
  pending[0].resolve({ event: { title: 'Imported title', city: 'Orlando' } }); await initial;
  edit('city', 'Custom city');
  elements.eventUrl.value = 'https://tickets.acme.com/next';
  importer.schedule();
  assert.equal(elements.eventName.value, '');
  assert.equal(elements.city.value, 'Custom city');
  const stale = importer.start(); importer.reset();
  pending[1].resolve({ event: { title: 'Stale' } }); await stale;
  assert.equal(elements.eventName.value, '');
  assert.equal(importer.busy, false);
});

test("client preserves existing event values and does not mix manual and imported time boundaries", async () => {
  const { importer, elements, pending } = clientFixture();
  elements.eventUrl.value = pageUrl;
  elements.eventName.value = 'Existing title';
  elements.startsAt.value = '2026-11-19T20:00';
  const work = importer.start();
  pending[0].resolve({ event: parseEventPage(markup(sample), pageUrl) }); await work;
  assert.equal(elements.eventName.value, 'Existing title');
  assert.equal(elements.startsAt.value, '2026-11-19T20:00');
  assert.equal(elements.endsAt.value, '');
});

test("client errors unblock manual saving and saving prevents a concurrent import", async () => {
  const { importer, elements, pending, controls } = clientFixture();
  elements.eventUrl.value = pageUrl;
  const work = importer.start();
  pending[0].reject(new Error('This site blocks imports.')); await work;
  assert.equal(controls["button[type='submit']"].disabled, false);
  assert.equal(controls['[data-event-import-status]'].textContent, 'This site blocks imports.');
  importer.setSaving(true); await importer.start();
  assert.equal(pending.length, 1);
  assert.equal(elements.eventUrl.readOnly, true);
  importer.setSaving(false);
  assert.equal(elements.eventUrl.readOnly, false);
});
