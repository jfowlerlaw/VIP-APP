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

function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 100) return "";
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; } catch { return ""; }
}

function exactEventInstant(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/i);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59) return null;
  const day = new Date(`${match[1]}T12:00:00Z`);
  const date = new Date(value);
  return Number.isFinite(+day) && day.toISOString().slice(0, 10) === match[1] && Number.isFinite(+date) ? date : null;
}

function eventDates(startValue, endValue, timeZone) {
  const result = { startsAt: null, endsAt: null, dateLabel: "", timeLabel: "" };
  const start = typeof startValue === "string" ? startValue : "";
  const end = typeof endValue === "string" ? endValue : "";
  const dateMatch = start.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  if (!dateMatch) return result;
  const day = new Date(`${dateMatch[1]}T12:00:00Z`);
  if (!Number.isFinite(+day) || day.toISOString().slice(0, 10) !== dateMatch[1]) return result;
  result.dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(day);
  const startInstant = exactEventInstant(start);
  const endInstant = exactEventInstant(end);
  if (startInstant) {
    result.startsAt = startInstant.toISOString();
    if (endInstant && endInstant > startInstant) result.endsAt = endInstant.toISOString();
    const zone = validTimeZone(timeZone);
    if (zone) {
      result.dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }).format(startInstant);
      result.timeLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: zone }).format(startInstant);
    }
  }
  return result;
}

function mentionsEventDay(text, date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone }).formatToParts(date).map(({ type, value }) => [type, value]));
  const month = `${parts.month}|${parts.month.slice(0, 3)}\\.?`;
  const pattern = new RegExp(`\\b(?:${month})\\s+${parts.day}(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4}))?`, "gi");
  return [...text.matchAll(pattern)].some((match) => !match[1] || match[1] === parts.year);
}

function embeddedGameEvent($, pageUrl, article, headline, lead) {
  const games = new Map();
  $('[game], [data-game]').slice(0, 100).each((_index, element) => {
    let game;
    try { game = JSON.parse($(element).attr('game') || $(element).attr('data-game')); } catch { return; }
    if (!game || typeof game !== "object" || game.hide_date || game.is_published === false) return;
    if (typeof game.public_url !== "string" || !game.public_url.trim()) return;
    const start = exactEventInstant(game.time_starts);
    const zone = validTimeZone(game.home_timezone);
    if (!start || !zone) return;
    let url;
    try { url = publicEventUrl(game.public_url, pageUrl).href; } catch { return; }
    if (new URL(url).hostname !== new URL(pageUrl).hostname) return;
    games.set(`${url}|${start.toISOString()}`, { game, start, zone, url });
  });
  const candidates = [...games.values()];
  let matching = candidates.filter(({ url }) => url.replace(/\/$/, "") === pageUrl.replace(/\/$/, ""));
  // Related-game footers may contain many dates. Match the article's subject, never its publication date.
  if (!matching.length && article) {
    matching = candidates.filter(({ start, zone }) => mentionsEventDay(headline, start, zone));
    const headlineHasDate = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b/i.test(headline);
    if (!matching.length && !headlineHasDate) matching = candidates.filter(({ start, zone }) => mentionsEventDay(lead, start, zone));
  }
  if (matching.length !== 1) return null;
  const { game, zone } = matching[0];
  return {
    startDate: game.time_starts, endDate: game.time_ends || null, timeZone: zone,
    location: { name: game.venue_name, address: { addressLocality: typeof game.venue_location === "string" ? game.venue_location.split(",")[0].trim() : "" } },
  };
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
  const articles = nodes.filter((node) => types(node).some((type) => type === "Article" || type.endsWith("Article")) && node.headline);
  const article = articles.find(matchesPage) || (articles.length === 1 ? articles[0] : null);
  const headline = plainText(article?.headline || meta("og:title"), 500);
  const articleBody = $('[itemprop~="articleBody"]').first();
  const lead = plainText(articleBody.find('p').first().html() || articleBody.html() || article?.description || meta("og:description"), 1600);
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
  if (!event.startDate) {
    const game = embeddedGameEvent($, pageUrl, article, headline, lead);
    if (game) event = { ...game, ...event, startDate: game.startDate, endDate: event.endDate || game.endDate,
      timeZone: event.timeZone || game.timeZone, location: event.location || game.location };
  }
  const location = dereference([event.location].flat()[0]) || {};
  const address = dereference(location.address) || {};
  const dates = eventDates(event.startDate || meta("event:start_time"), event.endDate || meta("event:end_time"), event.timeZone || event.eventSchedule?.scheduleTimezone);
  const title = plainText(event.name || article?.headline || meta("og:title") || meta("twitter:title") || $("h1").first().text() || $("title").text(), 150);
  return {
    title, copy: plainText(event.description || meta("og:description") || meta("description") || meta("twitter:description")),
    image: imageUrl(dereference(Array.isArray(event.image) ? event.image[0] : event.image), pageUrl) || imageUrl(meta("og:image:secure_url") || meta("og:image") || meta("twitter:image"), pageUrl),
    location: plainText(typeof location === "string" ? location : location.name, 200),
    city: plainText(address.addressLocality, 160),
    address: plainText(typeof address === "string" ? address : address.streetAddress
      ? [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode].filter((part) => typeof part === "string").join(", ") : "", 300),
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
  if (!event.startsAt) missing.push("start date/time");
  if (!event.location) missing.push("venue");
  return { event, message: `Details imported. Review before publishing.${missing.length ? ` Please confirm ${missing.join(", ")}.` : ""}${event.startsAt && !event.endsAt ? " No end time was listed." : ""}` };
}
