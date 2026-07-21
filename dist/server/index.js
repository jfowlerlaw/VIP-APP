const memberSessions = new Map();
const adminSessions = new Map();
const pendingClaims = new Map();
const maxBodyBytes = 1_000_000;

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
      preferences: { smsAlerts: true, emailUpdates: true, walletUpdates: true },
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
      preferences: { smsAlerts: true, emailUpdates: true, walletUpdates: true },
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
      preferences: { smsAlerts: false, emailUpdates: true, walletUpdates: true },
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
      image: "https://justcallmoe.com/wp-content/uploads/2024/04/Just-Call-Moe-VIP-Signup-4.webp",
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
      image: "https://justcallmoe.com/wp-content/uploads/2024/04/Just-Call-Moe-VIP-Signup-1.webp",
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
  ],
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return handleApi(request, env, url);
      }
      return serveAsset(request, env, url);
    } catch (error) {
      return json({ message: "Server error", error: error.message }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/health") return json({ ok: true, mode: "vip-sites" });
  if (route === "GET /api/events") {
    const db = await readDb(env);
    return json({ events: db.events.filter((event) => event.visible !== false) });
  }
  if (route === "GET /api/me") {
    const member = await requireMember(request, env);
    return member ? json({ member: publicMember(member) }) : json({ message: "Not signed in" }, 401);
  }
  if (route === "POST /api/claim/start") {
    const body = await readJsonBody(request);
    const db = await readDb(env);
    const member = findMemberForClaim(db.members, body.identity, body.lastName);
    if (!member) {
      return json({ message: "If this matches a VIP record, a verification code will be sent." }, 404);
    }

    const claimToken = token();
    const code = env.VIP_DEV_CODE || "246810";
    pendingClaims.set(claimToken, {
      code,
      memberId: member.id,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    return json({
      claimToken,
      destination: maskDestination(member, body.identity),
      devCode: env.VIP_SHOW_CODES === "false" ? undefined : code,
    });
  }
  if (route === "POST /api/claim/verify") {
    const body = await readJsonBody(request);
    const claim = pendingClaims.get(String(body.claimToken || ""));
    const code = String(body.code || "").trim();
    if (!claim || claim.expiresAt < Date.now() || !safeEqual(code, claim.code)) {
      return json({ message: "That code did not match." }, 400);
    }

    const db = await readDb(env);
    const member = db.members.find((item) => item.id === claim.memberId);
    if (!member) return json({ message: "Member record not found." }, 404);

    member.claimedAt = new Date().toISOString();
    if (member.status === "Unclaimed") member.status = "Active";
    await writeDb(env, db);
    pendingClaims.delete(String(body.claimToken || ""));

    const sessionToken = token();
    memberSessions.set(sessionToken, { memberId: member.id, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    return json({ member: publicMember(member), sessionToken }, 200, [
      cookie("vip_session", sessionToken, { maxAge: 60 * 60 * 24 * 30, httpOnly: true }),
    ]);
  }
  if (route === "POST /api/profile") {
    const member = await requireMember(request, env);
    if (!member) return json({ message: "Not signed in" }, 401);
    const body = await readJsonBody(request);
    const db = await readDb(env);
    const storedMember = db.members.find((item) => item.id === member.id);
    storedMember.cardName = String(body.cardName || storedMember.name).trim() || storedMember.name;
    storedMember.preferences = { ...storedMember.preferences, ...body.preferences };
    await writeDb(env, db);
    return json({ member: publicMember(storedMember) });
  }
  if (route === "POST /api/requests") {
    const member = await requireMember(request, env);
    if (!member) return json({ message: "Not signed in" }, 401);
    const body = await readJsonBody(request);
    const type = String(body.type || "VIP request").trim() || "VIP request";
    const message = String(body.message || "").trim();
    if (!message) {
      return json({ message: "Add a short message before sending." }, 400);
    }

    const db = await readDb(env);
    const requestRecord = {
      id: `req_${Date.now()}_${shortId()}`,
      memberId: member.id,
      memberName: member.cardName || member.name,
      type,
      message,
      emailTo: env.VIP_REQUEST_EMAIL || "vip@justcallmoe.com",
      status: "Open",
      createdAt: new Date().toISOString(),
    };
    const email = await sendConciergeEmail({ env, member, requestRecord });
    requestRecord.emailStatus = email.status;
    if (email.sentAt) requestRecord.emailSentAt = email.sentAt;
    if (email.error) requestRecord.emailError = email.error;

    db.requests.unshift(requestRecord);
    await writeDb(env, db);
    if (email.status !== "sent") {
      return json(
        {
          message:
            "The VIP desk email could not be sent. Please call 833-MOE-WINS or email vip@justcallmoe.com.",
          request: requestRecord,
          email,
        },
        502
      );
    }

    return json({ request: requestRecord, email }, 201);
  }
  if (route === "POST /api/admin/login") {
    const body = await readJsonBody(request);
    if (!safeEqual(String(body.password || ""), env.VIP_ADMIN_PASSWORD || "moe-beta")) {
      return json({ message: "Incorrect admin password." }, 401);
    }
    const sessionToken = token();
    adminSessions.set(sessionToken, { expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
    return json({ ok: true }, 200, [cookie("vip_admin", sessionToken, { maxAge: 60 * 60 * 12, httpOnly: true })]);
  }
  if (route === "POST /api/admin/logout") {
    return json({ ok: true }, 200, [clearCookie("vip_admin")]);
  }
  if (url.pathname.startsWith("/api/admin/")) {
    if (!requireAdmin(request)) return json({ message: "Admin login required." }, 401);
    return handleAdminApi(request, env, url);
  }
  return json({ message: "API route not found" }, 404);
}

async function handleAdminApi(request, env, url) {
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/admin/summary") {
    return json({ summary: buildSummary(await readDb(env)) });
  }
  if (route === "GET /api/admin/members") {
    const db = await readDb(env);
    return json({ members: db.members.map(publicMember) });
  }
  if (route === "POST /api/admin/members") {
    const body = await readJsonBody(request);
    const db = await readDb(env);
    const member = normalizeMemberRecord(body, db.members.length);
    db.members.unshift(member);
    await writeDb(env, db);
    return json({ member: publicMember(member), summary: buildSummary(db) }, 201);
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/members/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/members/", ""));
    const db = await readDb(env);
    const index = db.members.findIndex((member) => member.id === id);
    if (index === -1) return json({ message: "Member not found." }, 404);
    const [deletedMember] = db.members.splice(index, 1);
    db.requests = db.requests.filter((item) => item.memberId !== id);
    removeMemberSessions(id);
    await writeDb(env, db);
    return json({
      deletedMember: publicMember(deletedMember),
      members: db.members.map(publicMember),
      requests: db.requests,
      summary: buildSummary(db),
    });
  }
  if (route === "POST /api/admin/import") {
    const body = await readJsonBody(request);
    const db = await readDb(env);
    const records = Array.isArray(body.records) ? body.records : [];
    const status = String(body.status || "Unclaimed");
    const imported = [];
    const skipped = [];
    for (const record of records) {
      const email = String(record.email || "").trim().toLowerCase();
      const phone = digitsOnly(record.phone);
      const duplicate = db.members.find((member) => (email && member.email === email) || (phone && member.phone === phone));
      if (duplicate) {
        skipped.push({ ...record, reason: "Duplicate email or phone" });
        continue;
      }
      const member = normalizeMemberRecord({ ...record, status }, db.members.length + imported.length);
      db.members.unshift(member);
      imported.push(publicMember(member));
    }
    await writeDb(env, db);
    return json({ imported, skipped, members: db.members.map(publicMember), summary: buildSummary(db) });
  }
  if (route === "GET /api/admin/events") {
    const db = await readDb(env);
    return json({ events: db.events });
  }
  if (route === "POST /api/admin/events") {
    const body = await readJsonBody(request);
    const db = await readDb(env);
    const eventRecord = {
      id: `evt_${Date.now()}_${shortId()}`,
      title: String(body.title || body.eventName || "VIP Event").trim(),
      copy: String(body.copy || body.eventCopy || "VIP member event.").trim(),
      city: String(body.city || body.location || body.eventLocation || "Orlando").trim(),
      dateLabel: String(body.dateLabel || body.eventDate || "TBD").trim(),
      timeLabel: String(body.timeLabel || "Eventbrite").trim(),
      location: String(body.location || body.eventLocation || "Orlando").trim(),
      source: "Eventbrite",
      eventbriteUrl: String(body.eventbriteUrl || body.eventUrl || "").trim(),
      image: String(body.image || "").trim() || "https://justcallmoe.com/wp-content/uploads/2024/04/Just-Call-Moe-VIP-Signup-4.webp",
      visible: true,
    };
    db.events.unshift(eventRecord);
    await writeDb(env, db);
    return json({ event: eventRecord, events: db.events, summary: buildSummary(db) }, 201);
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/events/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/events/", ""));
    const db = await readDb(env);
    const index = db.events.findIndex((event) => event.id === id);
    if (index === -1) return json({ message: "Event not found." }, 404);
    const [deletedEvent] = db.events.splice(index, 1);
    await writeDb(env, db);
    return json({ deletedEvent, events: db.events, summary: buildSummary(db) });
  }
  if (route === "GET /api/admin/requests") {
    const db = await readDb(env);
    return json({ requests: db.requests });
  }
  if (request.method === "PATCH" && url.pathname.startsWith("/api/admin/requests/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/admin/requests/", ""));
    const body = await readJsonBody(request);
    const db = await readDb(env);
    const requestRecord = db.requests.find((item) => item.id === id);
    if (!requestRecord) return json({ message: "Request not found." }, 404);
    requestRecord.status = String(body.status || requestRecord.status);
    await writeDb(env, db);
    return json({ request: requestRecord, summary: buildSummary(db) });
  }
  return json({ message: "Admin API route not found" }, 404);
}

async function sendConciergeEmail({ env, member, requestRecord }) {
  const memberEmail = member.email || "";
  const memberPhone = member.phone || "";
  const requestEmail = env.VIP_REQUEST_EMAIL || "vip@justcallmoe.com";
  const subject = `Just Call Moe VIP Request - ${requestRecord.type}`;
  const content = [
    `VIP Member: ${requestRecord.memberName}`,
    `Member ID: ${member.memberId || "Unknown"}`,
    `Email: ${memberEmail || "Not provided"}`,
    `Phone: ${memberPhone || "Not provided"}`,
    `Request Type: ${requestRecord.type}`,
    `Submitted: ${requestRecord.createdAt}`,
    "",
    "Message:",
    requestRecord.message,
  ].join("\n");

  const payload = {
    personalizations: [
      {
        to: [{ email: requestEmail }],
        subject,
      },
    ],
    from: {
      email: env.VIP_FROM_EMAIL,
      name: env.VIP_FROM_NAME || "Just Call Moe VIP Portal",
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
      name: requestRecord.memberName,
    };
  }

  return sendEmail({ env, payload });
}

async function sendEmail({ env, payload }) {
  const apiKey = env.SENDGRID_API_KEY;
  const fromEmail = env.VIP_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    return {
      status: "not_configured",
      error: "Set SENDGRID_API_KEY and VIP_FROM_EMAIL to send email automatically.",
    };
  }

  payload.from = {
    email: payload.from?.email || fromEmail,
    name: payload.from?.name || env.VIP_FROM_NAME || "Just Call Moe VIP Portal",
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

async function serveAsset(request, env, url) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }
  if (url.pathname === "/") {
    url = new URL(request.url);
    url.pathname = "/index.html";
    request = new Request(url, request);
  }
  return env.ASSETS.fetch(request);
}

async function readDb(env) {
  await ensureDb(env);
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE id = ?").bind("vip-db").first();
  return row ? { ...seedDatabase, ...JSON.parse(row.value) } : structuredClone(seedDatabase);
}

async function writeDb(env, db) {
  await ensureDb(env);
  await env.DB.prepare("INSERT OR REPLACE INTO app_state (id, value, updated_at) VALUES (?, ?, ?)")
    .bind("vip-db", JSON.stringify(db), new Date().toISOString())
    .run();
}

async function ensureDb(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  const row = await env.DB.prepare("SELECT id FROM app_state WHERE id = ?").bind("vip-db").first();
  if (!row) {
    await env.DB.prepare("INSERT INTO app_state (id, value, updated_at) VALUES (?, ?, ?)")
      .bind("vip-db", JSON.stringify(seedDatabase), new Date().toISOString())
      .run();
  }
}

async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > maxBodyBytes) throw new Error("Request body too large");
  return text ? JSON.parse(text) : {};
}

async function requireMember(request, env) {
  const session = memberSessions.get(memberSessionTokenFromRequest(request));
  if (!session || session.expiresAt < Date.now()) return null;
  const db = await readDb(env);
  return db.members.find((member) => member.id === session.memberId) || null;
}

function memberSessionTokenFromRequest(request) {
  const authorization = String(request.headers.get("Authorization") || "");
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return parseCookies(request).vip_session;
}

function requireAdmin(request) {
  const session = adminSessions.get(parseCookies(request).vip_admin);
  return Boolean(session && session.expiresAt > Date.now());
}

function removeMemberSessions(memberId) {
  for (const [sessionToken, session] of memberSessions.entries()) {
    if (session.memberId === memberId) memberSessions.delete(sessionToken);
  }
  for (const [claimToken, claim] of pendingClaims.entries()) {
    if (claim.memberId === memberId) pendingClaims.delete(claimToken);
  }
}

function normalizeMemberRecord(record, index = 0) {
  const name = String(record.name || record.fullName || record["Full Name"] || "VIP Member").trim();
  const email = String(record.email || record.Email || "").trim().toLowerCase();
  const phone = digitsOnly(record.phone || record.Phone || "");
  return {
    id: `mem_${Date.now()}_${index}_${shortId()}`,
    name,
    cardName: String(record.cardName || name).trim(),
    email,
    phone,
    city: String(record.city || record.location || record.City || "Orlando").trim(),
    memberId: record.memberId || `JCM-VIP-${String(251 + Number(index || 0)).padStart(4, "0")}`,
    joined: String(record.joined || new Date().getFullYear()),
    status: String(record.status || "Unclaimed"),
    claimedAt: null,
    preferences: { smsAlerts: true, emailUpdates: true, walletUpdates: true },
  };
}

function buildSummary(db) {
  return {
    activeMembers: db.members.filter((member) => member.status !== "Paused").length,
    openRequests: db.requests.filter((request) => request.status !== "Closed").length,
    eventLinks: db.events.filter((event) => event.visible !== false).length,
  };
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
    return (
      memberLastName === cleanLastName &&
      (member.email.toLowerCase() === cleanIdentity ||
        (cleanPhone.length >= 4 && (member.phone === cleanPhone || member.phone.endsWith(cleanPhone))))
    );
  });
}

function json(data, status = 200, cookies = []) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  for (const item of cookies) headers.append("Set-Cookie", item);
  return new Response(JSON.stringify(data), { status, headers });
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.get("Cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [key, decodeURIComponent(value.join("="))];
      })
  );
}

function cookie(name, value, options = {}) {
  const pieces = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${options.maxAge || 3600}`,
  ];
  if (options.httpOnly) pieces.push("HttpOnly");
  if (options.secure !== false) pieces.push("Secure");
  return pieces.join("; ");
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
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
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shortId() {
  return token().slice(0, 6);
}

function safeEqual(value, expected) {
  return String(value) === String(expected);
}
