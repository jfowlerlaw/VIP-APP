import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { load, loadBuffer } from "cheerio";
import ipaddr from "ipaddr.js";

const maxPageBytes = 2_000_000;
const importTimeout = 12_000;
const unavailable = "This site could not be read automatically. It may block imports or require a browser. You can still enter the details below.";

export class EventImportError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

export function publicEventUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new EventImportError("Enter a valid public event link.", 400); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 4000) {
    throw new EventImportError("Use a public http or https event link without login details or a custom port.", 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !ipaddr.isValid(host) || /\.(localhost|local|internal|test|invalid|example)$/i.test(host) || host === "localhost") {
    throw new EventImportError("Use a publicly accessible event website.", 400);
  }
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new EventImportError("Use a publicly accessible event website.", 400);
  url.hash = "";
  return url;
}

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}

export async function resolvePublicAddress(url, resolve = lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try { addresses = await resolve(host, { all: true, verbatim: true }); } catch { throw new EventImportError(unavailable); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new EventImportError("Use a publicly accessible event website.", 400);
  }
  return addresses.find(({ family }) => family === 4) || addresses[0];
}

// Each hop is checked and its DNS result is pinned to the socket, including redirects.
export async function fetchEventPage(value, { resolve = lookup, request, timeout = importTimeout, maxBytes = maxPageBytes } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abortable = (promise) => new Promise((resolve, reject) => {
    const abort = () => reject(new EventImportError("The event website took too long to respond. Try again or enter the details manually."));
    if (controller.signal.aborted) { abort(); return; }
    controller.signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", abort));
  });
  try {
    let url = publicEventUrl(value);
    for (let redirects = 0; redirects <= 4; redirects++) {
      const address = await abortable(resolvePublicAddress(url, resolve));
      const result = await abortable(new Promise((resolve, reject) => {
        const send = request || (url.protocol === "https:" ? https.request : http.request);
        const req = send(url, {
          method: "GET", signal: controller.signal, agent: false,
          headers: { "User-Agent": "MoeVIP-EventImporter/1.0", Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "gzip, deflate, br" },
          lookup: (_host, options, callback) => options.all
            ? callback(null, [address]) : callback(null, address.address, address.family),
        }, (res) => {
          const status = res.statusCode;
          if ([301, 302, 303, 307, 308].includes(status)) {
            resolve({ redirect: res.headers.location }); res.destroy(); return;
          }
          if (status !== 200) { reject(new EventImportError(unavailable)); res.destroy(); return; }
          const encoding = (res.headers['content-encoding'] || 'identity').trim().toLowerCase();
          if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(res.headers['content-type'] || "") ||
              !['identity', 'gzip', 'deflate', 'br'].includes(encoding)) {
            reject(new EventImportError("This link is not a readable event web page. Enter the event details manually.")); res.destroy(); return;
          }
          const decoders = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };
          const stream = encoding === 'identity' ? res : res.pipe(decoders[encoding]());
          let wireSize = 0;
          let size = 0;
          const chunks = [];
          res.on("data", (chunk) => {
            wireSize += chunk.length;
            if (wireSize > maxBytes) {
              reject(new EventImportError("This event page is too large to import. Enter the details manually."));
              res.destroy(); stream.destroy();
            }
          });
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) { reject(new EventImportError("This event page is too large to import. Enter the details manually.")); res.destroy(); stream.destroy(); }
            else chunks.push(chunk);
          });
          stream.on("end", () => resolve({ html: Buffer.concat(chunks) }));
          stream.on("error", (error) => { res.destroy(); reject(error); });
          res.on("error", reject);
          res.on("aborted", () => { stream.destroy(); reject(new EventImportError(unavailable)); });
        });
        req.on("error", reject);
        req.end();
      }));
      if (result.html) return { html: result.html, url: url.href };
      if (!result.redirect || redirects === 4) throw new EventImportError(unavailable);
      url = publicEventUrl(result.redirect, url);
    }
  } catch (error) {
    if (error instanceof EventImportError) throw error;
    throw new EventImportError(unavailable);
  } finally { clearTimeout(timer); controller.abort(); }
}

function plainText(value, max = 5000) {
  if (typeof value !== "string") return "";
  const $ = load(value.slice(0, 30000));
  $("script,style,noscript").remove();
  $("br").replaceWith("\n");
  $("p,div,li").append("\n");
  return $.text().replace(/[\t\r ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function imageUrl(value, base) {
  if (Array.isArray(value)) value = value[0];
  if (value && typeof value === "object") value = value.contentUrl || value.url || value['@id'];
  if (typeof value !== "string" || !value.trim()) return "";
  try { return publicEventUrl(value, base).href; } catch { return ""; }
}

function eventDates(startValue, endValue) {
  const result = { startsAt: null, endsAt: null, dateLabel: "", timeLabel: "" };
  const start = typeof startValue === "string" ? startValue : "";
  const end = typeof endValue === "string" ? endValue : "";
  const dateMatch = start.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  if (!dateMatch) return result;
  const day = new Date(`${dateMatch[1]}T12:00:00Z`);
  if (!Number.isFinite(+day) || day.toISOString().slice(0, 10) !== dateMatch[1]) return result;
  result.dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(day);
  // Only import exact instants when both boundaries include an explicit UTC offset.
  const exact = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i;
  if (exact.test(start) && exact.test(end) && Number.isFinite(+new Date(start)) && new Date(end) > new Date(start)) {
    result.startsAt = new Date(start).toISOString(); result.endsAt = new Date(end).toISOString();
  }
  return result;
}

export function parseEventPage(html, pageUrl) {
  const $ = Buffer.isBuffer(html) ? loadBuffer(html) : load(html);
  const meta = (name) => $("meta").toArray().find((el) => ($(el).attr("property") || $(el).attr("name") || "").toLowerCase() === name)?.attribs.content || "";
  const nodes = [];
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 24 || nodes.length > 5000) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    nodes.push(value);
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  $('script[type="application/ld+json"]').each((_index, el) => {
    try { visit(JSON.parse($(el).text())); } catch { /* Ignore malformed structured data and use the remaining metadata. */ }
  });
  const references = new Map(nodes.filter((node) => typeof node['@id'] === "string" && Object.keys(node).length > 1).map((node) => [node['@id'], node]));
  const dereference = (node) => node && typeof node === "object" && node['@id'] ? references.get(node['@id']) || node : node;
  const types = (node) => [node['@type']].flat().filter((value) => typeof value === "string").map((value) => value.split(/[\/#]/).at(-1));
  const events = nodes.filter((node) => types(node).some((type) => type === "Event" || type.endsWith("Event")) && node.name);
  const matchesPage = (node) => [node.url, node['@id'], node.mainEntityOfPage?.['@id'], node.mainEntityOfPage].some((value) => {
    try { return typeof value === "string" && publicEventUrl(value, pageUrl).href.replace(/\/$/, "") === pageUrl.replace(/\/$/, ""); } catch { return false; }
  });
  let event = events.find(matchesPage) || (events.length === 1 ? events[0] : {});
  if (!event.name && events.length === 0) {
    const scopes = $('[itemscope][itemtype]').filter((_index, el) => /(?:\/|#)\w*Event$/.test($(el).attr('itemtype') || ""));
    if (scopes.length === 1) {
      const scope = scopes.first();
      const property = (parent, name) => {
        const element = parent.find(`[itemprop~="${name}"]`).first();
        return element.attr('content') || element.attr('datetime') || element.attr('src') || element.attr('href') || element.text();
      };
      const venue = scope.find('[itemprop~="location"]').first();
      const address = venue.find('[itemprop~="address"]').first();
      event = { name: property(scope, 'name'), description: property(scope, 'description'), image: property(scope, 'image'),
        startDate: property(scope, 'startDate'), endDate: property(scope, 'endDate'),
        location: { name: property(venue, 'name'), address: { streetAddress: property(address, 'streetAddress'),
          addressLocality: property(address, 'addressLocality'), addressRegion: property(address, 'addressRegion'), postalCode: property(address, 'postalCode') } } };
    }
  }
  const location = dereference([event.location].flat()[0]) || {};
  const address = dereference(location.address) || {};
  const dates = eventDates(event.startDate || meta("event:start_time"), event.endDate || meta("event:end_time"));
  const title = plainText(event.name || meta("og:title") || meta("twitter:title") || $("h1").first().text() || $("title").text(), 150);
  return {
    title, copy: plainText(event.description || meta("og:description") || meta("description") || meta("twitter:description")),
    image: imageUrl(dereference(Array.isArray(event.image) ? event.image[0] : event.image), pageUrl) || imageUrl(meta("og:image:secure_url") || meta("og:image") || meta("twitter:image"), pageUrl),
    location: plainText(typeof location === "string" ? location : location.name, 200),
    city: plainText(address.addressLocality, 160),
    address: plainText(typeof address === "string" ? address : [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode].filter((part) => typeof part === "string").join(", "), 300),
    ...dates,
  };
}

export async function importEvent(value, options = {}) {
  const page = await fetchEventPage(value, options);
  const event = parseEventPage(page.html, page.url);
  if (!event.title && !event.image && !event.copy) throw new EventImportError(unavailable);
  if (/^(just a moment|access denied|attention required|funnybone\.com)$/i.test(event.title) && !event.image) throw new EventImportError(unavailable);
  if (event.image) {
    let timer;
    try { await Promise.race([resolvePublicAddress(new URL(event.image), options.resolve), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Image lookup timed out")), 3000); })]); }
    catch { event.image = ""; }
    finally { clearTimeout(timer); }
  }
  const missing = [];
  if (!event.image) missing.push("photo");
  if (!event.startsAt || !event.endsAt) missing.push("start/end times");
  if (!event.location) missing.push("venue");
  return { event, message: `Details imported. Review before publishing.${missing.length ? ` Please confirm ${missing.join(", ")}.` : ""}` };
}
