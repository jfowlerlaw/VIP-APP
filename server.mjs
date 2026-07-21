import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createDatabase } from "./database.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
loadLocalEnv();

const scryptAsync = promisify(scrypt);
const port = Number(process.env.PORT || process.argv.at(2) || 8787);
const host = process.env.HOST || "127.0.0.1";
const memberSessions = new Map();
const adminSessions = new Map();
const pendingClaims = new Map();
const maxBodyBytes = 1_000_000;
const conciergeEmail = process.env.VIP_REQUEST_EMAIL || "vip@justcallmoe.com";
const passwordMinLength = 8;
const passwordHashParams = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const nativeCorsOrigins = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost",
  ...(process.env.VIP_NATIVE_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

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

const vipDb = createDatabase({ rootDir, seedDatabase });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { message: "Server error" });
  }
});

await vipDb.ensureDatabase();

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
    sendJson(res, 200, { ok: true, mode: "vip-beta", database: vipDb.mode });
    return;
  }

  if (route === "GET /api/events") {
    sendJson(res, 200, {
      events: await vipDb.listEvents({ visibleOnly: true }),
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
    const db = await vipDb.readDb();
    const member = findMemberForClaim(db.members, identity, lastName);

    if (!member) {
      sendJson(res, 404, {
        message: "If this matches a VIP record, a verification code will be sent.",
      });
      return;
    }

    const claimToken = token();
    const code = verificationCode();
    pendingClaims.set(claimToken, {
      code,
      memberId: member.id,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    if (showDevCodes()) {
      console.log(`[vip beta] Verification code for ${member.name}: ${code}`);
    }
    const email = await sendVerificationEmail({ member, code });

    sendJson(res, 200, {
      claimToken,
      destination: maskDestination(member, identity),
      devCode: showDevCodes() ? code : undefined,
      email,
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

    const member = await vipDb.getMemberById(claim.memberId);
    if (!member) {
      sendJson(res, 404, { message: "Member record not found." });
      return;
    }

    const updatedMember = await vipDb.updateMember(member.id, {
      claimedAt: new Date().toISOString(),
      status: memberStatusAfterClaim(member.status),
    });
    if (!updatedMember) {
      sendJson(res, 404, { message: "Member record not found." });
      return;
    }
    pendingClaims.delete(String(body.claimToken || ""));

    createMemberSession(req, res, updatedMember.id);
    sendJson(res, 200, { member: publicMember(updatedMember) });
    return;
  }

  if (route === "POST /api/login/password") {
    const body = await readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const failedLoginMessage =
      "Email or password did not match. If you have not created a password yet, use Email code first.";

    if (!email.includes("@") || password.length === 0) {
      sendJson(res, 400, { message: "Enter your email and password." });
      return;
    }

    const db = await vipDb.readDb();
    const member = findMemberByEmail(db.members, email);
    if (!member || member.status === "Paused") {
      sendJson(res, 401, { message: failedLoginMessage });
      return;
    }

    if (!member.passwordHash) {
      sendJson(res, 401, { message: failedLoginMessage });
      return;
    }

    if (!(await verifyPassword(password, member.passwordHash))) {
      sendJson(res, 401, { message: failedLoginMessage });
      return;
    }

    createMemberSession(req, res, member.id);
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
    const cardName = String(body.cardName || member.name).trim() || member.name;
    const storedMember = await vipDb.updateMember(member.id, {
      cardName,
      preferences: {
        ...member.preferences,
        ...body.preferences,
      },
    });
    if (!storedMember) {
      sendJson(res, 404, { message: "Member record not found." });
      return;
    }
    sendJson(res, 200, { member: publicMember(storedMember) });
    return;
  }

  if (route === "POST /api/profile/password") {
    const member = await requireMember(req);
    if (!member) {
      sendJson(res, 401, { message: "Not signed in" });
      return;
    }

    const body = await readJsonBody(req);
    const password = String(body.password || "");
    if (password.length < passwordMinLength) {
      sendJson(res, 400, { message: `Use at least ${passwordMinLength} characters for your password.` });
      return;
    }

    let storedMember;
    try {
      storedMember = await vipDb.updateMember(member.id, {
        passwordHash: await hashPassword(password),
        passwordSetAt: new Date().toISOString(),
        claimedAt: member.claimedAt || new Date().toISOString(),
        status: memberStatusAfterClaim(member.status),
      });
    } catch (error) {
      if (/password_hash|password_set_at/i.test(error.message || "")) {
        sendJson(res, 500, {
          message: "Password storage is not set up yet. Run the latest Supabase schema SQL first.",
        });
        return;
      }
      throw error;
    }

    if (!storedMember) {
      sendJson(res, 404, { message: "Member record not found." });
      return;
    }
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

    await vipDb.createRequest(request);
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
    const db = await vipDb.readDb();
    sendJson(res, 200, { summary: buildSummary(db) });
    return;
  }

  if (route === "GET /api/admin/members") {
    const members = await vipDb.listMembers();
    sendJson(res, 200, { members: members.map(publicMember) });
    return;
  }

  if (route === "POST /api/admin/members") {
    const body = await readJsonBody(req);
    const members = await vipDb.listMembers();
    const member = await vipDb.createMember(normalizeMemberRecord(body, members.length));
    const db = await vipDb.readDb();
    sendJson(res, 201, {
      member: publicMember(member),
      summary: buildSummary(db),
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/members/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/members/", ""));
    const result = await vipDb.deleteMember(id);
    if (!result) {
      sendJson(res, 404, { message: "Member not found." });
      return;
    }

    removeMemberSessions(id);
    const db = await vipDb.readDb();
    sendJson(res, 200, {
      deletedMember: publicMember(result.deletedMember),
      deletedRequests: result.deletedRequests,
      members: db.members.map(publicMember),
      requests: db.requests,
      summary: buildSummary(db),
    });
    return;
  }

  if (route === "POST /api/admin/import") {
    const body = await readJsonBody(req);
    const records = Array.isArray(body.records) ? body.records : [];
    const defaultStatus = String(body.status || "Unclaimed");
    const existingMembers = await vipDb.listMembers();
    const knownMembers = [...existingMembers];
    const imported = [];
    const skipped = [];
    const membersToCreate = [];

    records.forEach((record) => {
      const hasEmail = String(record.email || "").trim();
      const phone = digitsOnly(String(record.phone || ""));
      const duplicate = knownMembers.find((member) => {
        return (
          (hasEmail && member.email.toLowerCase() === hasEmail.toLowerCase()) ||
          (phone && member.phone === phone)
        );
      });

      if (duplicate) {
        skipped.push({ ...record, reason: "Duplicate email or phone" });
        return;
      }

      const status = String(record.status || defaultStatus);
      const member = normalizeMemberRecord({ ...record, status }, knownMembers.length + imported.length);
      knownMembers.unshift(member);
      membersToCreate.push(member);
      imported.push(publicMember(member));
    });

    await vipDb.createMembers(membersToCreate);
    const db = await vipDb.readDb();
    sendJson(res, 200, {
      imported,
      skipped,
      members: db.members.map(publicMember),
      summary: buildSummary(db),
    });
    return;
  }

  if (route === "GET /api/admin/events") {
    sendJson(res, 200, { events: await vipDb.listEvents() });
    return;
  }

  if (route === "POST /api/admin/events") {
    const body = await readJsonBody(req);
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
    const storedEvent = await vipDb.createEvent(event);
    const db = await vipDb.readDb();
    sendJson(res, 201, {
      event: storedEvent,
      events: db.events,
      summary: buildSummary(db),
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/events/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/events/", ""));
    const deletedEvent = await vipDb.deleteEvent(id);
    if (!deletedEvent) {
      sendJson(res, 404, { message: "Event not found." });
      return;
    }

    const db = await vipDb.readDb();
    sendJson(res, 200, {
      deletedEvent,
      events: db.events,
      summary: buildSummary(db),
    });
    return;
  }

  if (route === "GET /api/admin/requests") {
    sendJson(res, 200, { requests: await vipDb.listRequests() });
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/requests/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/requests/", ""));
    const body = await readJsonBody(req);
    const request = await vipDb.updateRequestStatus(id, String(body.status || "Open"));
    if (!request) {
      sendJson(res, 404, { message: "Request not found." });
      return;
    }
    const db = await vipDb.readDb();
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

async function sendConciergeEmail({ member, request }) {
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
      email: process.env.VIP_FROM_EMAIL,
      name: process.env.VIP_FROM_NAME || "Just Call Moe VIP Portal",
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

  return sendEmail(payload);
}

async function sendVerificationEmail({ member, code }) {
  const memberEmail = member.email || "";

  if (!memberEmail.includes("@")) {
    return {
      status: "failed",
      error: "VIP member record does not have a valid email address.",
    };
  }

  const content = [
    `Hi ${member.firstName || member.name || "there"},`,
    "",
    "Use this code to finish signing in to your Just Call Moe VIP portal:",
    "",
    code,
    "",
    "This code expires in 15 minutes.",
    "",
    "If you did not request this code, you can ignore this email.",
    "",
    "Just Call Moe VIP Team",
  ].join("\n");

  return sendEmail({
    personalizations: [
      {
        to: [{ email: memberEmail, name: member.name }],
        subject: "Your Just Call Moe VIP sign-in code",
      },
    ],
    from: {
      email: process.env.VIP_FROM_EMAIL,
      name: process.env.VIP_FROM_NAME || "Just Call Moe VIP Portal",
    },
    content: [
      {
        type: "text/plain",
        value: content,
      },
    ],
  });
}

async function sendEmail(payload) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.VIP_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    return {
      status: "not_configured",
      error: "Set SENDGRID_API_KEY and VIP_FROM_EMAIL to send email automatically.",
    };
  }

  payload.from = {
    email: payload.from?.email || fromEmail,
    name: payload.from?.name || process.env.VIP_FROM_NAME || "Just Call Moe VIP Portal",
  };

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
    activeMembers: db.members.filter((member) => !isPausedStatus(member.status)).length,
    openRequests: db.requests.filter((request) => request.status !== "Closed").length,
    eventLinks: db.events.filter((event) => event.visible !== false).length,
  };
}

function normalizeMemberRecord(record, index = 0) {
  const firstName = String(recordValue(record, [
    "firstName",
    "first_name",
    "first name",
    "firstname",
    "first",
    "given_name",
    "client_first_name",
    "contact_first_name",
  ])).trim();
  const lastName = String(recordValue(record, [
    "lastName",
    "last_name",
    "last name",
    "lastname",
    "last",
    "surname",
    "family_name",
    "client_last_name",
    "contact_last_name",
  ])).trim();
  const name = displayNameFromParts({
    firstName,
    lastName,
    name: recordValue(record, ["name", "fullName", "full_name", "full name", "fullname", "client_name"]),
  });
  const email = String(recordValue(record, ["email", "email_address", "emailaddress", "e_mail"])).trim().toLowerCase();
  const phone = digitsOnly(String(recordValue(record, ["phone", "phone_number", "phonenumber", "mobile", "mobile_phone"])));
  const joined = String(recordValue(record, ["joined", "join_year", "year_joined"]) || new Date().getFullYear());

  return {
    id: `mem_${Date.now()}_${index}_${randomBytes(3).toString("hex")}`,
    firstName: firstName || firstNameFromName(name),
    lastName: lastName || lastNameFromName(name),
    name,
    cardName: String(recordValue(record, ["cardName", "card_name", "card name"]) || name).trim(),
    email,
    phone,
    city: String(recordValue(record, ["city", "location", "market"]) || "Orlando").trim(),
    memberId: recordValue(record, ["memberId", "member_id", "member id", "vip_id", "vip id"]) || nextMemberId(index),
    joined,
    status: String(recordValue(record, ["status", "vip_status", "vip status"]) || "Unclaimed"),
    claimedAt: null,
    preferences: {
      smsAlerts: true,
      emailUpdates: true,
      walletUpdates: true,
    },
  };
}

function recordValue(record, aliases) {
  const normalizedEntries = Object.entries(record || {}).reduce((values, [key, value]) => {
    values[normalizeRecordKey(key)] = value;
    return values;
  }, {});

  for (const alias of aliases) {
    const value = normalizedEntries[normalizeRecordKey(alias)];
    if (value) return value;
  }

  return "";
}

function normalizeRecordKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function nextMemberId(index) {
  return `JCM-VIP-${String(251 + Number(index || 0)).padStart(4, "0")}`;
}

function publicMember(member) {
  const name = displayNameFromParts(member);
  const status = displayMemberStatus(member);
  return {
    id: member.id,
    firstName: member.firstName || firstNameFromName(name),
    lastName: member.lastName || lastNameFromName(name),
    name,
    cardName: member.cardName || name,
    email: member.email,
    phone: member.phone,
    city: member.city,
    memberId: member.memberId,
    joined: member.joined,
    status,
    claimedAt: member.claimedAt,
    hasPassword: Boolean(member.passwordHash),
    passwordSetAt: member.passwordSetAt || null,
    preferences: member.preferences || {},
  };
}

function findMemberByEmail(members, email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return null;
  return members.find((member) => String(member.email || "").toLowerCase() === cleanEmail) || null;
}

function findMemberForClaim(members, identity, lastName) {
  const cleanIdentity = String(identity || "").trim().toLowerCase();
  const cleanPhone = digitsOnly(identity);
  const cleanLastName = String(lastName || "").trim().toLowerCase();

  return members.find((member) => {
    if (isPausedStatus(member.status)) return false;

    const memberLastName = String(member.lastName || lastNameFromName(member.name)).toLowerCase();
    const emailMatches = member.email.toLowerCase() === cleanIdentity;
    const phoneMatches =
      cleanPhone.length >= 4 && (member.phone === cleanPhone || member.phone.endsWith(cleanPhone));

    return memberLastName === cleanLastName && (emailMatches || phoneMatches);
  });
}

function displayMemberStatus(member) {
  const status = String(member.status || "Unclaimed").trim() || "Unclaimed";
  const isClaimed = Boolean(member.claimedAt || member.passwordSetAt || member.passwordHash);
  return isClaimed && isUnclaimedStatus(status) ? "Active" : status;
}

function memberStatusAfterClaim(status) {
  const cleanStatus = String(status || "").trim();
  return !cleanStatus || isUnclaimedStatus(cleanStatus) ? "Active" : cleanStatus;
}

function isUnclaimedStatus(status) {
  return String(status || "").trim().toLowerCase() === "unclaimed";
}

function isPausedStatus(status) {
  return String(status || "").trim().toLowerCase() === "paused";
}

function displayNameFromParts(member) {
  const firstName = String(member.firstName || member.first_name || "").trim();
  const lastName = String(member.lastName || member.last_name || "").trim();
  const joinedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const fallbackName = String(member.name || "").trim();
  return joinedName || fallbackName || "VIP Member";
}

function firstNameFromName(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).at(0) || "";
}

function lastNameFromName(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).at(-1) || "";
}

async function requireMember(req) {
  const cookies = parseCookies(req);
  const sessionToken = cookies.vip_session;
  const session = sessionToken ? memberSessions.get(sessionToken) : null;
  if (!session || session.expiresAt < Date.now()) return null;

  return vipDb.getMemberById(session.memberId);
}

function createMemberSession(req, res, memberId) {
  const sessionToken = token();
  memberSessions.set(sessionToken, {
    memberId,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
  });

  setCookie(res, "vip_session", sessionToken, {
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    ...nativeCookieOptions(req),
  });
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

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (!nativeCorsOrigins.has(origin)) return;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Vary", "Origin");
}

function nativeCookieOptions(req) {
  const origin = String(req.headers.origin || "");
  if (!nativeCorsOrigins.has(origin)) return {};

  return {
    sameSite: "None",
    secure: true,
  };
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
    `SameSite=${options.sameSite || "Lax"}`,
    `Max-Age=${options.maxAge || 3600}`,
  ];
  if (options.httpOnly) pieces.push("HttpOnly");
  if (options.secure) pieces.push("Secure");
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

function verificationCode() {
  if (showDevCodes() && process.env.VIP_DEV_CODE) {
    return process.env.VIP_DEV_CODE;
  }

  return String(randomInt(100000, 999999));
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64, passwordHashParams);
  return [
    "scrypt",
    passwordHashParams.N,
    passwordHashParams.r,
    passwordHashParams.p,
    salt,
    Buffer.from(derivedKey).toString("hex"),
  ].join("$");
}

async function verifyPassword(password, storedHash) {
  const [algorithm, rawN, rawR, rawP, salt, hash] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  if (expected.length === 0) return false;

  const options = {
    N: Number(rawN),
    r: Number(rawR),
    p: Number(rawP),
    maxmem: passwordHashParams.maxmem,
  };

  if (!Number.isFinite(options.N) || !Number.isFinite(options.r) || !Number.isFinite(options.p)) {
    return false;
  }

  try {
    const derivedKey = await scryptAsync(password, salt, expected.length, options);
    const actual = Buffer.from(derivedKey);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
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
