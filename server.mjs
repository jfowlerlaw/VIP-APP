import { createServer } from "node:http";
import http2 from "node:http2";
import { stat } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createSign, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
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
const apnsJwtCache = {
  cacheKey: "",
  token: "",
  createdAt: 0,
};
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
  perks: [
    {
      id: "perk_shop_discount",
      title: "Shop discount",
      description: "Use code MOEVIP for merchandise at Shop.JustCallMoe.com.",
      note: "Available now",
      icon: "badge-percent",
      accent: "red",
      buttonLabel: "Copy",
      actionUrl: "",
      actionMessage: "VIP shop code copied: MOEVIP",
      visible: true,
    },
    {
      id: "perk_merch_alerts",
      title: "Free merch alerts",
      description: "Be first to hear when new VIP merchandise drops.",
      note: "SMS and email eligible",
      icon: "megaphone",
      accent: "blue",
      buttonLabel: "On",
      actionUrl: "",
      actionMessage: "Merch alerts enabled.",
      visible: true,
    },
    {
      id: "perk_private_group",
      title: "Private group",
      description: "Access the members-only Just Call Moe VIP Facebook community.",
      note: "Members-only access",
      icon: "users",
      accent: "green",
      buttonLabel: "Join",
      actionUrl: "https://www.facebook.com/share/g/1B5JVZj46a/",
      actionMessage: "",
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
  pushTokens: [],
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

  if (route === "GET /api/perks") {
    const perks = await vipDb.listPerks({ visibleOnly: true });
    sendJson(res, 200, { perks: perks.map(publicPerk) });
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

  if (route === "POST /api/logout") {
    const sessionToken = memberSessionTokenFromRequest(req);
    if (sessionToken) {
      memberSessions.delete(sessionToken);
    }
    clearCookie(res, "vip_session");
    sendJson(res, 200, { ok: true });
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

    const sessionToken = createMemberSession(req, res, updatedMember.id);
    sendJson(res, 200, { member: publicMember(updatedMember), sessionToken });
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

    const sessionToken = createMemberSession(req, res, member.id);
    sendJson(res, 200, { member: publicMember(member), sessionToken });
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

  if (route === "GET /api/push/status") {
    const member = await requireMember(req);
    if (!member) {
      sendJson(res, 401, { message: "Not signed in" });
      return;
    }

    const tokens = await vipDb.listPushTokens({ memberId: member.id, enabledOnly: true });
    sendJson(res, 200, {
      enabled: tokens.length > 0,
      tokens: tokens.map(publicPushToken),
    });
    return;
  }

  if (route === "POST /api/push/register") {
    const member = await requireMember(req);
    if (!member) {
      sendJson(res, 401, { message: "Not signed in" });
      return;
    }

    const body = await readJsonBody(req);
    const tokenValue = String(body.token || body.value || "").trim();
    if (tokenValue.length < 10) {
      sendJson(res, 400, { message: "Push token was not available yet." });
      return;
    }

    const now = new Date().toISOString();
    const pushToken = {
      id: `push_${Date.now()}_${randomBytes(3).toString("hex")}`,
      memberId: member.id,
      token: tokenValue,
      platform: normalizePushPlatform(body.platform),
      provider: String(body.provider || "capacitor").trim().slice(0, 40) || "capacitor",
      device: String(body.device || "").trim().slice(0, 160),
      enabled: true,
      lastRegisteredAt: now,
      createdAt: now,
      updatedAt: now,
    };

    let storedToken;
    try {
      storedToken = await vipDb.upsertPushToken(pushToken);
    } catch (error) {
      if (/vip_push_tokens/i.test(error.message || "")) {
        sendJson(res, 500, {
          message: "Push notification storage is not set up yet. Run the latest Supabase schema SQL first.",
        });
        return;
      }
      throw error;
    }

    sendJson(res, 200, {
      enabled: true,
      token: publicPushToken(storedToken),
    });
    return;
  }

  if (route === "POST /api/push/unregister") {
    const member = await requireMember(req);
    if (!member) {
      sendJson(res, 401, { message: "Not signed in" });
      return;
    }

    const body = await readJsonBody(req);
    const tokenValue = String(body.token || "").trim();
    const deletedTokens = await vipDb.deletePushToken({
      memberId: member.id,
      token: tokenValue || undefined,
    });

    sendJson(res, 200, {
      enabled: false,
      deleted: deletedTokens.length,
    });
    return;
  }

  if (route === "POST /api/requests") {
    const member = await requireMember(req);
    if (!member) {
      sendJson(res, 401, { message: "Not signed in" });
      return;
    }

    const body = await readJsonBody(req);
    const type = String(body.type || "VIP request").trim() || "VIP request";
    const phone = String(body.phone || "").trim();
    const message = String(body.message || "").trim();
    if (!phone) {
      sendJson(res, 400, { message: "Add a phone number before sending." });
      return;
    }

    if (!message) {
      sendJson(res, 400, { message: "Add a short message before sending." });
      return;
    }

    const request = {
      id: `req_${Date.now()}_${randomBytes(3).toString("hex")}`,
      memberId: member.id,
      memberName: member.cardName || member.name,
      type,
      phone,
      message,
      emailTo: conciergeEmail,
      status: "Open",
      createdAt: new Date().toISOString(),
    };

    const email = await sendConciergeEmail({ member, request });
    request.emailStatus = email.status;
    if (email.sentAt) request.emailSentAt = email.sentAt;
    if (email.error) request.emailError = email.error;

    await vipDb.createRequest(request);
    if (email.status !== "sent") {
      sendJson(res, 502, {
        message:
          "The VIP desk email could not be sent. Please call 833-MOE-WINS or email vip@justcallmoe.com.",
        request,
        email,
      });
      return;
    }

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

  if (route === "GET /api/admin/perks") {
    const perks = await vipDb.listPerks();
    sendJson(res, 200, { perks: perks.map(publicPerk) });
    return;
  }

  if (route === "POST /api/admin/perks") {
    const body = await readJsonBody(req);
    const perk = await vipDb.createPerk(normalizePerkRecord(body));
    const db = await vipDb.readDb();
    sendJson(res, 201, {
      perk: publicPerk(perk),
      perks: (db.perks || []).map(publicPerk),
      summary: buildSummary(db),
    });
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/perks/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/perks/", ""));
    const body = await readJsonBody(req);
    const perk = await vipDb.updatePerk(id, normalizePerkPatch(body));
    if (!perk) {
      sendJson(res, 404, { message: "Perk not found." });
      return;
    }

    const db = await vipDb.readDb();
    sendJson(res, 200, {
      perk: publicPerk(perk),
      perks: (db.perks || []).map(publicPerk),
      summary: buildSummary(db),
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/perks/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/perks/", ""));
    const deletedPerk = await vipDb.deletePerk(id);
    if (!deletedPerk) {
      sendJson(res, 404, { message: "Perk not found." });
      return;
    }

    const db = await vipDb.readDb();
    sendJson(res, 200, {
      deletedPerk: publicPerk(deletedPerk),
      perks: (db.perks || []).map(publicPerk),
      summary: buildSummary(db),
    });
    return;
  }

  if (route === "GET /api/admin/requests") {
    sendJson(res, 200, { requests: await vipDb.listRequests() });
    return;
  }

  if (route === "GET /api/admin/push-tokens") {
    const tokens = await listAdminPushTokens();
    sendJson(res, 200, { tokens });
    return;
  }

  if (route === "GET /api/admin/push/status") {
    const tokens = await listAdminPushTokens();
    sendJson(res, 200, {
      apns: apnsSetupStatus(),
      tokens,
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/push-tokens/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/push-tokens/", ""));
    if (!id) {
      sendJson(res, 400, { message: "Push device id is required." });
      return;
    }

    const deletedTokens = await vipDb.deletePushToken({ id });
    if (deletedTokens.length === 0) {
      sendJson(res, 404, { message: "Push device not found." });
      return;
    }

    const db = await vipDb.readDb();
    sendJson(res, 200, {
      deleted: deletedTokens.map(publicPushToken),
      apns: apnsSetupStatus(),
      tokens: await listAdminPushTokens(),
      summary: buildSummary(db),
    });
    return;
  }

  if (route === "POST /api/admin/push/send-test") {
    const body = await readJsonBody(req);
    const rawTokens = await vipDb.listPushTokens({ enabledOnly: true });
    const targetToken = selectPushTestToken(rawTokens, body.tokenId);

    if (!targetToken) {
      sendJson(res, 404, { message: "No enabled iPhone push token is available yet." });
      return;
    }

    const apnsStatus = apnsSetupStatus();
    if (!apnsStatus.configured) {
      sendJson(res, 400, {
        message: `APNs is missing: ${apnsStatus.missing.join(", ")}.`,
        apns: apnsStatus,
      });
      return;
    }

    const member = targetToken.memberId ? await vipDb.getMemberById(targetToken.memberId) : null;
    const title = normalizePushTitle(body.title);
    const message = normalizePushMessage(
      body.message || body.body,
      "This is a test notification from the VIP admin portal.",
    );

    let result;
    try {
      result = await sendApnsNotification({
        token: targetToken.token,
        title,
        body: message,
        data: {
          view: "events",
          source: "admin-test",
        },
      });
    } catch (error) {
      sendJson(res, 502, {
        message: error.message || "APNs request failed.",
        apns: apnsStatus,
        token: publicAdminPushToken(targetToken, member),
      });
      return;
    }

    const publicToken = publicAdminPushToken(targetToken, member);
    if (!result.ok) {
      sendJson(res, 502, {
        message: apnsFailureMessage(result),
        apns: apnsStatus,
        token: publicToken,
        result,
      });
      return;
    }

    sendJson(res, 200, {
      message: `Test push sent to ${publicToken.memberName || publicToken.memberEmail || "the selected VIP device"}.`,
      apns: apnsStatus,
      token: publicToken,
      result,
    });
    return;
  }

  if (route === "POST /api/admin/push/broadcast") {
    const body = await readJsonBody(req);
    const apnsStatus = apnsSetupStatus();
    if (!apnsStatus.configured) {
      sendJson(res, 400, {
        message: `APNs is missing: ${apnsStatus.missing.join(", ")}.`,
        apns: apnsStatus,
      });
      return;
    }

    const targets = (await listAdminPushTokenRows()).filter(
      ({ pushToken }) => pushToken.enabled !== false && normalizePushPlatform(pushToken.platform) === "ios",
    );

    if (targets.length === 0) {
      sendJson(res, 404, { message: "No enabled iPhone push tokens are available yet.", apns: apnsStatus });
      return;
    }

    const title = normalizePushTitle(body.title);
    const message = normalizePushMessage(
      body.message || body.body,
      "You have a new VIP update from Just Call Moe.",
    );
    const deliveries = [];
    const failures = [];

    for (const { pushToken, member } of targets) {
      const publicToken = publicAdminPushToken(pushToken, member);
      try {
        const result = await sendApnsNotification({
          token: pushToken.token,
          title,
          body: message,
          data: {
            view: "events",
            source: "admin-broadcast",
          },
        });

        if (result.ok) {
          deliveries.push({
            token: publicToken,
            apnsId: result.apnsId || "",
            status: result.status,
          });
        } else {
          failures.push({
            token: publicToken,
            status: result.status,
            reason: result.reason || "APNsRejected",
            message: apnsFailureMessage(result),
          });
        }
      } catch (error) {
        failures.push({
          token: publicToken,
          status: 0,
          reason: "RequestFailed",
          message: error.message || "APNs request failed.",
        });
      }
    }

    sendJson(res, 200, {
      message: `Broadcast complete: ${deliveries.length} sent, ${failures.length} failed.`,
      apns: apnsStatus,
      summary: {
        requested: targets.length,
        sent: deliveries.length,
        failed: failures.length,
      },
      failures: failures.slice(0, 20),
    });
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

async function listAdminPushTokens() {
  return (await listAdminPushTokenRows()).map(({ pushToken, member }) => publicAdminPushToken(pushToken, member));
}

async function listAdminPushTokenRows() {
  const [tokens, members] = await Promise.all([
    vipDb.listPushTokens({ enabledOnly: true }),
    vipDb.listMembers(),
  ]);
  const membersById = new Map(members.map((member) => [member.id, member]));

  return tokens
    .slice()
    .sort((left, right) => {
      const leftDate = new Date(left.lastRegisteredAt || left.updatedAt || left.createdAt || 0).getTime();
      const rightDate = new Date(right.lastRegisteredAt || right.updatedAt || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    })
    .map((pushToken) => ({
      pushToken,
      member: membersById.get(pushToken.memberId),
    }));
}

function selectPushTestToken(tokens, tokenId) {
  const iosTokens = (tokens || [])
    .filter((pushToken) => pushToken.enabled !== false && normalizePushPlatform(pushToken.platform) === "ios")
    .sort((left, right) => {
      const leftDate = new Date(left.lastRegisteredAt || left.updatedAt || left.createdAt || 0).getTime();
      const rightDate = new Date(right.lastRegisteredAt || right.updatedAt || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    });

  if (tokenId) {
    return iosTokens.find((pushToken) => pushToken.id === tokenId) || null;
  }

  return iosTokens[0] || null;
}

function normalizePushTitle(value, fallback = "Just Call Moe VIP") {
  return String(value || fallback).trim().slice(0, 80) || fallback;
}

function normalizePushMessage(value, fallback) {
  return String(value || fallback).trim().slice(0, 180) || fallback;
}

function apnsSetupStatus() {
  const environment = apnsEnvironment();
  const keyId = String(process.env.APNS_KEY_ID || "").trim();
  const teamId = String(process.env.APNS_TEAM_ID || "").trim();
  const bundleId = apnsBundleId();
  const privateKeyPath = String(process.env.APNS_PRIVATE_KEY_PATH || "").trim();
  const hasPrivateKeyValue = Boolean(String(process.env.APNS_PRIVATE_KEY || "").trim());
  const missing = [];

  if (!teamId) missing.push("APNS_TEAM_ID");
  if (!keyId) missing.push("APNS_KEY_ID");
  if (!bundleId) missing.push("APNS_BUNDLE_ID");
  if (!privateKeyPath && !hasPrivateKeyValue) {
    missing.push("APNS_PRIVATE_KEY_PATH or APNS_PRIVATE_KEY");
  } else if (privateKeyPath && !existsSync(privateKeyPath)) {
    missing.push(`APNS_PRIVATE_KEY_PATH file (${privateKeyPath})`);
  }

  return {
    configured: missing.length === 0,
    environment,
    host: apnsHost(environment).replace(/^https:\/\//, ""),
    bundleId,
    keyId: maskSecret(keyId),
    teamId: maskSecret(teamId),
    privateKeySource: privateKeyPath ? "secret file" : hasPrivateKeyValue ? "environment variable" : "missing",
    missing,
  };
}

function getApnsConfig() {
  const status = apnsSetupStatus();
  if (!status.configured) {
    throw new Error(`APNs is missing: ${status.missing.join(", ")}.`);
  }

  return {
    environment: status.environment,
    host: apnsHost(status.environment),
    keyId: String(process.env.APNS_KEY_ID || "").trim(),
    teamId: String(process.env.APNS_TEAM_ID || "").trim(),
    bundleId: apnsBundleId(),
    privateKey: readApnsPrivateKey(),
  };
}

function apnsEnvironment() {
  const environment = String(process.env.APNS_ENV || "sandbox").trim().toLowerCase();
  return environment === "production" || environment === "prod" ? "production" : "sandbox";
}

function apnsHost(environment) {
  return environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
}

function apnsBundleId() {
  return String(process.env.APNS_BUNDLE_ID || "com.justcallmoe.vipapp").trim();
}

function readApnsPrivateKey() {
  const privateKeyPath = String(process.env.APNS_PRIVATE_KEY_PATH || "").trim();
  if (privateKeyPath) {
    return normalizeApnsPrivateKey(readFileSync(privateKeyPath, "utf8"));
  }

  return normalizeApnsPrivateKey(process.env.APNS_PRIVATE_KEY || "");
}

function normalizeApnsPrivateKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n");
}

function apnsProviderToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = [config.teamId, config.keyId, config.privateKey].join(":");
  if (apnsJwtCache.cacheKey === cacheKey && apnsJwtCache.token && now - apnsJwtCache.createdAt < 20 * 60) {
    return apnsJwtCache.token;
  }

  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64Url(JSON.stringify({ iss: config.teamId, iat: now }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({ key: config.privateKey, dsaEncoding: "ieee-p1363" });
  const token = `${signingInput}.${base64Url(signature)}`;

  apnsJwtCache.cacheKey = cacheKey;
  apnsJwtCache.token = token;
  apnsJwtCache.createdAt = now;

  return token;
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sendApnsNotification({ token, title, body, data = {} }) {
  const config = getApnsConfig();
  const authorization = `bearer ${apnsProviderToken(config)}`;
  const payload = JSON.stringify({
    aps: {
      alert: { title, body },
      sound: "default",
    },
    ...data,
  });
  const client = http2.connect(config.host);

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBody = "";
    let statusCode = 0;
    let apnsId = "";
    const timeout = setTimeout(() => {
      fail(new Error("APNs request timed out."));
      client.destroy();
    }, 15000);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.close();
      resolve(result);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.destroy();
      reject(error);
    };

    client.on("error", fail);

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": "0",
      "apns-request-id": randomUUID(),
      "content-type": "application/json",
    });

    request.setEncoding("utf8");
    request.on("response", (headers) => {
      statusCode = Number(headers[":status"] || 0);
      apnsId = String(headers["apns-id"] || "");
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.on("error", fail);
    request.on("end", () => {
      const details = parseApnsResponseBody(responseBody);
      finish({
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        apnsId,
        reason: details.reason || "",
        details,
      });
    });
    request.end(payload);
  });
}

function parseApnsResponseBody(rawBody) {
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    return { raw: rawBody };
  }
}

function apnsFailureMessage(result) {
  if (result.reason === "TopicDisallowed") {
    return "APNs rejected this app topic. Confirm APNS_BUNDLE_ID exactly matches the iOS bundle ID, Push Notifications is enabled for that App ID in Apple Developer, and the APNs key belongs to the same Apple team.";
  }

  if (result.reason === "DeviceTokenNotForTopic") {
    return "APNs says this device token belongs to a different app topic. Reinstall the latest app build, enable push again, and confirm APNS_BUNDLE_ID matches the iOS bundle ID.";
  }

  if (result.reason === "BadTopic") {
    return "APNs rejected the topic header. APNS_BUNDLE_ID should be the plain app bundle ID, such as com.justcallmoe.vipapp.";
  }

  if (result.reason === "InvalidProviderToken") {
    return "APNs rejected the provider token. Recheck APNS_TEAM_ID, APNS_KEY_ID, and the .p8 private key contents; the Key ID must match the downloaded AuthKey file and belong to the same Apple team.";
  }

  if (result.reason === "ExpiredProviderToken") {
    return "APNs says the provider token is expired. Redeploy Render so the server restarts and generates a fresh APNs token.";
  }

  if (result.reason === "BadEnvironmentKeyIdInToken") {
    return "APNs says the key ID does not match this APNs environment. Confirm APNS_ENV and the APNs key in Apple Developer.";
  }

  if (result.reason === "BadDeviceToken") {
    return "APNs rejected that device token. Make sure APNS_ENV matches this build: sandbox for Xcode, production for TestFlight/App Store.";
  }

  if (result.reason) {
    return `APNs rejected the test notification: ${result.reason}.`;
  }

  return `APNs rejected the test notification with status ${result.status || "unknown"}.`;
}

async function sendConciergeEmail({ member, request }) {
  const memberEmail = member.email || "";
  const memberPhone = member.phone || "";
  const callbackPhone = request.phone || "";
  const subject = `Just Call Moe VIP Request - ${request.type}`;
  const content = [
    `VIP Member: ${request.memberName}`,
    `Member ID: ${member.memberId || "Unknown"}`,
    `Email: ${memberEmail || "Not provided"}`,
    `Callback Phone: ${callbackPhone || "Not provided"}`,
    `Member Record Phone: ${memberPhone || "Not provided"}`,
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
    pushDevices: (db.pushTokens || []).filter((pushToken) => pushToken.enabled !== false).length,
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

function normalizePerkRecord(record) {
  const patch = normalizePerkPatch(record);
  return {
    id: `perk_${Date.now()}_${randomBytes(3).toString("hex")}`,
    title: patch.title || "VIP Perk",
    description: patch.description || "",
    note: patch.note || "",
    icon: patch.icon || "star",
    accent: patch.accent || "red",
    buttonLabel: patch.buttonLabel || "View",
    actionUrl: patch.actionUrl || "",
    actionMessage: patch.actionMessage || "",
    visible: record.visible !== false,
  };
}

function normalizePerkPatch(record) {
  const patch = {};
  if ("title" in record) {
    patch.title = String(record.title || "VIP Perk").trim().slice(0, 80) || "VIP Perk";
  }
  if ("description" in record) {
    patch.description = String(record.description || "").trim().slice(0, 220);
  }
  if ("note" in record) {
    patch.note = String(record.note || "").trim().slice(0, 90);
  }
  if ("icon" in record) {
    patch.icon = normalizePerkIcon(record.icon);
  }
  if ("accent" in record) {
    patch.accent = normalizePerkAccent(record.accent);
  }
  if ("buttonLabel" in record) {
    patch.buttonLabel = String(record.buttonLabel || "View").trim().slice(0, 24) || "View";
  }
  if ("actionUrl" in record) {
    patch.actionUrl = normalizeOptionalUrl(record.actionUrl);
  }
  if ("actionMessage" in record) {
    patch.actionMessage = String(record.actionMessage || "").trim().slice(0, 120);
  }
  if ("visible" in record) {
    patch.visible = record.visible !== false;
  }

  return patch;
}

function normalizePerkIcon(icon) {
  const allowedIcons = new Set([
    "badge-percent",
    "bell",
    "calendar-days",
    "crown",
    "gift",
    "heart-handshake",
    "megaphone",
    "sparkles",
    "star",
    "ticket",
    "users",
  ]);
  const cleanIcon = String(icon || "").trim().toLowerCase();
  return allowedIcons.has(cleanIcon) ? cleanIcon : "star";
}

function normalizePerkAccent(accent) {
  const cleanAccent = String(accent || "").trim().toLowerCase();
  return ["red", "blue", "green", "yellow"].includes(cleanAccent) ? cleanAccent : "red";
}

function normalizeOptionalUrl(value) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) return "";

  try {
    const url = new URL(rawUrl);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
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

function publicPerk(perk) {
  return {
    id: perk.id,
    title: perk.title || "VIP Perk",
    description: perk.description || "",
    note: perk.note || "",
    icon: normalizePerkIcon(perk.icon),
    accent: normalizePerkAccent(perk.accent),
    buttonLabel: perk.buttonLabel || "View",
    actionUrl: perk.actionUrl || "",
    actionMessage: perk.actionMessage || "",
    visible: perk.visible !== false,
  };
}

function publicPushToken(pushToken) {
  const tokenValue = String(pushToken.token || "");
  return {
    id: pushToken.id,
    memberId: pushToken.memberId,
    tokenPreview:
      tokenValue.length > 12 ? `${tokenValue.slice(0, 6)}...${tokenValue.slice(-6)}` : "registered",
    platform: pushToken.platform,
    provider: pushToken.provider,
    device: pushToken.device,
    enabled: pushToken.enabled !== false,
    lastRegisteredAt: pushToken.lastRegisteredAt,
    createdAt: pushToken.createdAt,
  };
}

function publicAdminPushToken(pushToken, member) {
  return {
    ...publicPushToken(pushToken),
    memberName: member ? displayNameFromParts(member) : "",
    memberEmail: member?.email || "",
    memberCity: member?.city || "",
  };
}

function maskSecret(value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return "";
  if (cleanValue.length <= 4) return "set";
  return `${cleanValue.slice(0, 3)}...${cleanValue.slice(-2)}`;
}

function normalizePushPlatform(platform) {
  const cleanPlatform = String(platform || "").trim().toLowerCase();
  if (cleanPlatform === "ios" || cleanPlatform === "android" || cleanPlatform === "web") {
    return cleanPlatform;
  }
  return "ios";
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
  const sessionToken = memberSessionTokenFromRequest(req);
  const session = sessionToken ? memberSessions.get(sessionToken) : null;
  if (!session || session.expiresAt < Date.now()) return null;

  return vipDb.getMemberById(session.memberId);
}

function memberSessionTokenFromRequest(req) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return parseCookies(req).vip_session;
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
  return sessionToken;
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
