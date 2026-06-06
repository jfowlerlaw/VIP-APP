import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
loadLocalEnv();

const port = Number(process.env.PORT || process.argv.at(2) || 8787);
const host = process.env.HOST || "127.0.0.1";
const dataDir = join(rootDir, "data");
const dbPath = join(dataDir, "vip-db.json");
const memberSessions = new Map();
const adminSessions = new Map();
const pendingClaims = new Map();
const maxBodyBytes = 1_000_000;
const conciergeEmail = process.env.VIP_REQUEST_EMAIL || "vip@justcallmoe.com";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

const seedDatabase = {
  members: [
    {
      id: "mem_avery_mitchell",
      name: "Avery Mitchell",
      cardName: "Avery Mitchell",
      email: "avery@example.com",
      phone: "4075550188",
      city: "Orlando",
      memberId: "JCM-VIP-0248",
      joined: "2024",
      status: "Active",
      claimedAt: null,
      preferences: {
        smsAlerts: true,
        emailUpdates: true,
        walletUpdates: true,
      },
    },
    {
      id: "mem_jordan_rivera",
      name: "Jordan Rivera",
      cardName: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "4075550199",
      city: "Tampa",
      memberId: "JCM-VIP-0249",
      joined: "2025",
      status: "Active",
      claimedAt: null,
      preferences: {
        smsAlerts: true,
        emailUpdates: true,
        walletUpdates: true,
      },
    },
    {
      id: "mem_sam_carter",
      name: "Sam Carter",
      cardName: "Sam Carter",
      email: "sam@example.com",
      phone: "4075550177",
      city: "West Palm Beach",
      memberId: "JCM-VIP-0250",
      joined: "2024",
      status: "Paused",
      claimedAt: null,
      preferences: {
        smsAlerts: false,
        emailUpdates: true,
        walletUpdates: true,
      },
    },
  ],
  events: [
    {
      id: "evt_restaurant_night",
      title: "VIP Restaurant Night",
      copy: "Local restaurant invite for VIP members and guests.",
      city: "Orlando",
      dateLabel: "Jun 18",
      timeLabel: "6:30 PM",
      location: "Orlando",
      source: "Eventbrite",
      eventbriteUrl:
        "https://www.eventbrite.com/e/second-annual-just-call-moe-celebrity-bowl-o-rama-tickets-1237735242429",
      image:
        "https://justcallmoe.com/wp-content/uploads/2024/04/Just-Call-Moe-VIP-Signup-4.webp",
      visible: true,
    },
    {
      id: "evt_party_tampa",
      title: "Just Call Moe Party",
      copy: "Members-only celebration with VIP member welcome table.",
      city: "Tampa",
      dateLabel: "Jul 09",
      timeLabel: "7:00 PM",
      location: "Tampa",
      source: "Eventbrite",
      eventbriteUrl:
        "https://www.eventbrite.com/e/second-annual-just-call-moe-celebrity-bowl-o-rama-tickets-1237735242429",
      image:
        "https://justcallmoe.com/wp-content/uploads/2024/04/Just-Call-Moe-VIP-Signup-1.webp",
      visible: true,
    },
  ],
  requests: [
    {
      id: "req_avery_event_help",
      memberId: "mem_avery_mitchell",
      memberName: "Avery Mitchell",
      type: "Event help",
      message: "Can you send details about the next VIP Eventbrite listing?",
      emailTo: "vip@justcallmoe.com",
      status: "Open",
      createdAt: "2026-06-05T13:00:00.000Z",
    },
    {
      id: "req_jordan_profile",
      memberId: "mem_jordan_rivera",
      memberName: "Jordan Rivera",
      type: "Profile help",
      message: "Asked about VIP contact preferences.",
      emailTo: "vip@justcallmoe.com",
      status: "In review",
      createdAt: "2026-06-05T13:10:00.000Z",
    },
  ],
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { message: "Server error" });
  }
});

await ensureDatabase();

server.listen(port, host, () => {
  console.log(`VIP beta server running at http://127.0.0.1:${port}/index.html`);
  console.log(`Admin dashboard available at http://127.0.0.1:${port}/admin.html`);
  if (host !== "127.0.0.1") {
    console.log(`Network host enabled on ${host}:${port}`);
  }
  console.log(`Local admin password: ${adminPassword()}`);
});

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/health") {
    sendJson(res, 200, { ok: true, mode: "vip-beta" });
    return;
  }

  if (route === "GET /api/events") {
    const db = await readDb();
    sendJson(res, 200, {
      events: db.events.filter((event) => event.visible !== false),
    });
    return;
  }

  if (route === "GET /api/me") {
    const member = await requireMember(req);
    if (!member) {
      sendJson(res, 401, { message: "Not signed in" });
      return;
    }
    sendJson(res, 200, { member: publicMember(member) });
    return;
  }

  if (route === "POST /api/claim/start") {
    const body = await readJsonBody(req);
    const identity = String(body.identity || "");
    const lastName = String(body.lastName || "");
    const db = await readDb();
    const member = findMemberForClaim(db.members, identity, lastName);

    if (!member) {
      sendJson(res, 404, {
        message: "If this matches a VIP record, a verification code will be sent.",
      });
      return;
    }

    const claimToken = token();
    const code = process.env.VIP_DEV_CODE || String(randomInt(100000, 999999));
    pendingClaims.set(claimToken, {
      code,
      memberId: member.id,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    console.log(`[vip beta] Verification code for ${member.name}: ${code}`);

    sendJson(res, 200, {
      claimToken,
      destination: maskDestination(member, identity),
      devCode: showDevCodes() ? code : undefined,
    });
    return;
  }

  if (route === "POST /api/claim/verify") {
    const body = await readJsonBody(req);
    const claim = pendingClaims.get(String(body.claimToken || ""));
    const code = String(body.code || "").trim();

    if (!claim || claim.expiresAt < Date.now() || !safeEqual(code, claim.code)) {
      sendJson(res, 400, { message: "That code did not match." });
      return;
    }

    const db = await readDb();
    const member = db.members.find((item) => item.id === claim.memberId);
    if (!member) {
      sendJson(res, 404, { message: "Member record not found." });
      return;
    }

    member.claimedAt = new Date().toISOString();
    if (member.status === "Unclaimed") member.status = "Active";
    await writeDb(db);
    pendingClaims.delete(String(body.claimToken || ""));

    const sessionToken = token();
    memberSessions.set(sessionToken, {
      memberId: member.id,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
    });

    setCookie(res, "vip_session", sessionToken, {
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
    });
    sendJson(res, 200, { member: publicMember(member) });
    return;
  }

  if (route === "POST /api/profile") {
    const member = await requireMember(req);
    if (!member) {
      sendJson(res, 401, { message: "Not signed in" });
      return;
    }

    const body = await readJsonBody(req);
    const db = await readDb();
    const storedMember = db.members.find((item) => item.id === member.id);
    storedMember.cardName = String(body.cardName || storedMember.name).trim() || storedMember.name;
    storedMember.preferences = {
      ...storedMember.preferences,
      ...body.preferences,
    };
    await writeDb(db);
    sendJson(res, 200, { member: publicMember(storedMember) });
    return;
  }

  if (route === "POST /api/requests") {
    const member = await requireMember(req);
    if (!member) {
      sendJson(res, 401, { message: "Not signed in" });
      return;
    }

    const body = await readJsonBody(req);
    const db = await readDb();
    const request = {
      id: `req_${Date.now()}_${randomBytes(3).toString("hex")}`,
      memberId: member.id,
      memberName: member.cardName || member.name,
      type: String(body.type || "VIP request").trim(),
      message: String(body.message || "").trim(),
      emailTo: conciergeEmail,
      status: "Open",
      createdAt: new Date().toISOString(),
    };

    const email = await sendConciergeEmail({ member, request });
    request.emailStatus = email.status;
    if (email.sentAt) request.emailSentAt = email.sentAt;
    if (email.error) request.emailError = email.error;

    db.requests.unshift(request);
    await writeDb(db);
    sendJson(res, 201, { request, email });
    return;
  }

  if (route === "POST /api/admin/login") {
    const body = await readJsonBody(req);
    if (!safeEqual(String(body.password || ""), adminPassword())) {
      sendJson(res, 401, { message: "Incorrect admin password." });
      return;
    }

    const sessionToken = token();
    adminSessions.set(sessionToken, {
      expiresAt: Date.now() + 1000 * 60 * 60 * 12,
    });
    setCookie(res, "vip_admin", sessionToken, {
      maxAge: 60 * 60 * 12,
      httpOnly: true,
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (route === "POST /api/admin/logout") {
    clearCookie(res, "vip_admin");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (!requireAdmin(req)) {
      sendJson(res, 401, { message: "Admin login required." });
      return;
    }
    await handleAdminApi(req, res, url);
    return;
  }

  sendJson(res, 404, { message: "API route not found" });
}

async function handleAdminApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/admin/summary") {
    const db = await readDb();
    sendJson(res, 200, { summary: buildSummary(db) });
    return;
  }

  if (route === "GET /api/admin/members") {
    const db = await readDb();
    sendJson(res, 200, { members: db.members.map(publicMember) });
    return;
  }

  if (route === "POST /api/admin/members") {
    const body = await readJsonBody(req);
    const db = await readDb();
    const member = normalizeMemberRecord(body, db.members.length);
    db.members.unshift(member);
    await writeDb(db);
    sendJson(res, 201, {
      member: publicMember(member),
      summary: buildSummary(db),
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/members/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/members/", ""));
    const db = await readDb();
    const memberIndex = db.members.findIndex((member) => member.id === id);
    if (memberIndex === -1) {
      sendJson(res, 404, { message: "Member not found." });
      return;
    }

    const [deletedMember] = db.members.splice(memberIndex, 1);
    const originalRequestCount = db.requests.length;
    db.requests = db.requests.filter((request) => request.memberId !== id);
    removeMemberSessions(id);
    await writeDb(db);
    sendJson(res, 200, {
      deletedMember: publicMember(deletedMember),
      deletedRequests: originalRequestCount - db.requests.length,
      members: db.members.map(publicMember),
      requests: db.requests,
      summary: buildSummary(db),
    });
    return;
  }

  if (route === "POST /api/admin/import") {
    const body = await readJsonBody(req);
    const records = Array.isArray(body.records) ? body.records : [];
    const status = String(body.status || "Unclaimed");
    const db = await readDb();
    const imported = [];
    const skipped = [];

    records.forEach((record) => {
      const hasEmail = String(record.email || "").trim();
      const phone = digitsOnly(String(record.phone || ""));
      const duplicate = db.members.find((member) => {
        return (
          (hasEmail && member.email.toLowerCase() === hasEmail.toLowerCase()) ||
          (phone && member.phone === phone)
        );
      });

      if (duplicate) {
        skipped.push({ ...record, reason: "Duplicate email or phone" });
        return;
      }

      const member = normalizeMemberRecord({ ...record, status }, db.members.length + imported.length);
      db.members.unshift(member);
      imported.push(publicMember(member));
    });

    await writeDb(db);
    sendJson(res, 200, {
      imported,
      skipped,
      members: db.members.map(publicMember),
      summary: buildSummary(db),
    });
    return;
  }

  if (route === "GET /api/admin/events") {
    const db = await readDb();
    sendJson(res, 200, { events: db.events });
    return;
  }

  if (route === "POST /api/admin/events") {
    const body = await readJsonBody(req);
    const db = await readDb();
    const event = {
      id: `evt_${Date.now()}_${randomBytes(3).toString("hex")}`,
      title: String(body.title || body.eventName || "VIP Event").trim(),
      copy: String(body.copy || body.eventCopy || "VIP member event.").trim(),
      city: String(body.city || body.location || body.eventLocation || "Orlando").trim(),
      dateLabel: String(body.dateLabel || body.eventDate || "TBD").trim(),
      timeLabel: String(body.timeLabel || "Eventbrite").trim(),
      location: String(body.location || body.eventLocation || "Orlando").trim(),
      source: "Eventbrite",
      eventbriteUrl: String(body.eventbriteUrl || body.eventUrl || "").trim(),
      image:
        String(body.image || "").trim() ||
        "https://justcallmoe.com/wp-content/uploads/2024/04/Just-Call-Moe-VIP-Signup-4.webp",
      visible: true,
    };
    db.events.unshift(event);
    await writeDb(db);
    sendJson(res, 201, {
      event,
      events: db.events,
      summary: buildSummary(db),
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/events/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/events/", ""));
    const db = await readDb();
    const eventIndex = db.events.findIndex((event) => event.id === id);
    if (eventIndex === -1) {
      sendJson(res, 404, { message: "Event not found." });
      return;
    }

    const [deletedEvent] = db.events.splice(eventIndex, 1);
    await writeDb(db);
    sendJson(res, 200, {
      deletedEvent,
      events: db.events,
      summary: buildSummary(db),
    });
    return;
  }

  if (route === "GET /api/admin/requests") {
    const db = await readDb();
    sendJson(res, 200, { requests: db.requests });
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/requests/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/requests/", ""));
    const body = await readJsonBody(req);
    const db = await readDb();
    const request = db.requests.find((item) => item.id === id);
    if (!request) {
      sendJson(res, 404, { message: "Request not found." });
      return;
    }
    request.status = String(body.status || request.status);
    await writeDb(db);
    sendJson(res, 200, { request, summary: buildSummary(db) });
    return;
  }

  sendJson(res, 404, { message: "Admin API route not found" });
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const requestedPath = normalize(join(rootDir, pathname));
  if (relative(rootDir, requestedPath).startsWith("..")) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let filePath = requestedPath;
  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  const fileStat = await stat(filePath);
  if (fileStat.isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

async function ensureDatabase() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dbPath)) {
    await writeDb(seedDatabase);
  }
}

async function readDb() {
  await ensureDatabase();
  const raw = await readFile(dbPath, "utf8");
  return {
    ...seedDatabase,
    ...JSON.parse(raw),
  };
}

async function writeDb(db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);
}

async function sendConciergeEmail({ member, request }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.VIP_FROM_EMAIL;
  const fromName = process.env.VIP_FROM_NAME || "Just Call Moe VIP Portal";

  if (!apiKey || !fromEmail) {
    return {
      status: "not_configured",
      error: "Set SENDGRID_API_KEY and VIP_FROM_EMAIL to send email automatically.",
    };
  }

  const memberEmail = member.email || "";
  const memberPhone = member.phone || "";
  const subject = `Just Call Moe VIP Request - ${request.type}`;
  const content = [
    `VIP Member: ${request.memberName}`,
    `Member ID: ${member.memberId || "Unknown"}`,
    `Email: ${memberEmail || "Not provided"}`,
    `Phone: ${memberPhone || "Not provided"}`,
    `Request Type: ${request.type}`,
    `Submitted: ${request.createdAt}`,
    "",
    "Message:",
    request.message,
  ].join("\n");

  const payload = {
    personalizations: [
      {
        to: [{ email: conciergeEmail }],
        subject,
      },
    ],
    from: {
      email: fromEmail,
      name: fromName,
    },
    content: [
      {
        type: "text/plain",
        value: content,
      },
    ],
  };

  if (memberEmail.includes("@")) {
    payload.reply_to = {
      email: memberEmail,
      name: request.memberName,
    };
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 202) {
      return {
        status: "sent",
        sentAt: new Date().toISOString(),
      };
    }

    const errorText = await response.text();
    return {
      status: "failed",
      error: errorText || `SendGrid returned ${response.status}.`,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error.message || "Email send failed.",
    };
  }
}

function loadLocalEnv() {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return;

  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine.startsWith("#")) return;
      const equalsIndex = cleanLine.indexOf("=");
      if (equalsIndex === -1) return;
      const key = cleanLine.slice(0, equalsIndex).trim();
      const value = cleanLine.slice(equalsIndex + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    });
}

function buildSummary(db) {
  return {
    activeMembers: db.members.filter((member) => member.status !== "Paused").length,
    openRequests: db.requests.filter((request) => request.status !== "Closed").length,
    eventLinks: db.events.filter((event) => event.visible !== false).length,
  };
}

function normalizeMemberRecord(record, index = 0) {
  const name = String(record.name || record.fullName || record["Full Name"] || "VIP Member").trim();
  const email = String(record.email || record.Email || "").trim().toLowerCase();
  const phone = digitsOnly(String(record.phone || record.Phone || ""));
  const joined = String(record.joined || new Date().getFullYear());

  return {
    id: `mem_${Date.now()}_${index}_${randomBytes(3).toString("hex")}`,
    name,
    cardName: String(record.cardName || name).trim(),
    email,
    phone,
    city: String(record.city || record.location || record.City || "Orlando").trim(),
    memberId: record.memberId || nextMemberId(index),
    joined,
    status: String(record.status || "Unclaimed"),
    claimedAt: null,
    preferences: {
      smsAlerts: true,
      emailUpdates: true,
      walletUpdates: true,
    },
  };
}

function nextMemberId(index) {
  return `JCM-VIP-${String(251 + Number(index || 0)).padStart(4, "0")}`;
}

function publicMember(member) {
  return {
    id: member.id,
    name: member.name,
    cardName: member.cardName || member.name,
    email: member.email,
    phone: member.phone,
    city: member.city,
    memberId: member.memberId,
    joined: member.joined,
    status: member.status,
    claimedAt: member.claimedAt,
    preferences: member.preferences || {},
  };
}

function findMemberForClaim(members, identity, lastName) {
  const cleanIdentity = String(identity || "").trim().toLowerCase();
  const cleanPhone = digitsOnly(identity);
  const cleanLastName = String(lastName || "").trim().toLowerCase();

  return members.find((member) => {
    if (member.status === "Paused") return false;

    const memberLastName = member.name.split(/\s+/).pop().toLowerCase();
    const emailMatches = member.email.toLowerCase() === cleanIdentity;
    const phoneMatches =
      cleanPhone.length >= 4 && (member.phone === cleanPhone || member.phone.endsWith(cleanPhone));

    return memberLastName === cleanLastName && (emailMatches || phoneMatches);
  });
}

async function requireMember(req) {
  const cookies = parseCookies(req);
  const sessionToken = cookies.vip_session;
  const session = sessionToken ? memberSessions.get(sessionToken) : null;
  if (!session || session.expiresAt < Date.now()) return null;

  const db = await readDb();
  return db.members.find((member) => member.id === session.memberId) || null;
}

function removeMemberSessions(memberId) {
  for (const [sessionToken, session] of memberSessions.entries()) {
    if (session.memberId === memberId) {
      memberSessions.delete(sessionToken);
    }
  }

  for (const [claimToken, claim] of pendingClaims.entries()) {
    if (claim.memberId === memberId) {
      pendingClaims.delete(claimToken);
    }
  }
}

function requireAdmin(req) {
  const cookies = parseCookies(req);
  const sessionToken = cookies.vip_admin;
  const session = sessionToken ? adminSessions.get(sessionToken) : null;
  return Boolean(session && session.expiresAt > Date.now());
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(text);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [key, decodeURIComponent(value.join("="))];
      })
  );
}

function setCookie(res, name, value, options = {}) {
  const pieces = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${options.maxAge || 3600}`,
  ];
  if (options.httpOnly) pieces.push("HttpOnly");
  res.setHeader("Set-Cookie", pieces.join("; "));
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax`);
}

function maskDestination(member, identity) {
  if (String(identity).includes("@")) {
    const [user, domain] = member.email.split("@");
    return `${user.slice(0, 2)}***@${domain}`;
  }

  return `***-***-${member.phone.slice(-4)}`;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function token() {
  return randomBytes(24).toString("hex");
}

function adminPassword() {
  return process.env.VIP_ADMIN_PASSWORD || "moe-beta";
}

function showDevCodes() {
  return process.env.NODE_ENV !== "production" && process.env.VIP_SHOW_CODES !== "false";
}

function safeEqual(value, expected) {
  const left = Buffer.from(String(value));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
