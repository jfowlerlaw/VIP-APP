import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function createDatabase({ rootDir, seedDatabase }) {
  const dataDir = join(rootDir, "data");
  const dbPath = join(dataDir, "vip-db.json");
  const supabase = getSupabaseConfig();

  return {
    mode: supabase ? "supabase" : "local-json",
    ensureDatabase,
    readDb,
    listMembers,
    getMemberById,
    createMember,
    createMembers,
    updateMember,
    deleteMember,
    listEvents,
    createEvent,
    deleteEvent,
    listRequests,
    createRequest,
    updateRequestStatus,
  };

  async function ensureDatabase() {
    if (supabase) return;
    await mkdir(dataDir, { recursive: true });
    if (!existsSync(dbPath)) {
      await writeLocalDb(seedDatabase);
    }
  }

  async function readDb() {
    if (!supabase) return readLocalDb();

    const [members, events, requests] = await Promise.all([
      listMembers(),
      listEvents(),
      listRequests(),
    ]);

    return { members, events, requests };
  }

  async function listMembers() {
    if (!supabase) {
      const db = await readLocalDb();
      return db.members;
    }

    const rows = await supabaseRequest("vip_members", {
      query: queryString({ select: "*", order: "created_at.desc" }),
    });
    return rows.map(memberFromRow);
  }

  async function getMemberById(id) {
    if (!supabase) {
      const db = await readLocalDb();
      return db.members.find((member) => member.id === id) || null;
    }

    const rows = await supabaseRequest("vip_members", {
      query: queryString({ select: "*", id: `eq.${id}` }),
    });
    return rows[0] ? memberFromRow(rows[0]) : null;
  }

  async function createMember(member) {
    if (!supabase) {
      const db = await readLocalDb();
      db.members.unshift(member);
      await writeLocalDb(db);
      return member;
    }

    const rows = await supabaseRequest("vip_members", {
      method: "POST",
      body: memberToRow(member),
      headers: { Prefer: "return=representation" },
    });
    return memberFromRow(rows[0]);
  }

  async function createMembers(members) {
    if (!members.length) return [];

    if (!supabase) {
      const db = await readLocalDb();
      db.members.unshift(...members);
      await writeLocalDb(db);
      return members;
    }

    const rows = await supabaseRequest("vip_members", {
      method: "POST",
      body: members.map(memberToRow),
      headers: { Prefer: "return=representation" },
    });
    return rows.map(memberFromRow);
  }

  async function updateMember(id, patch) {
    if (!supabase) {
      const db = await readLocalDb();
      const member = db.members.find((item) => item.id === id);
      if (!member) return null;
      Object.assign(member, patch);
      await writeLocalDb(db);
      return member;
    }

    const rows = await supabaseRequest("vip_members", {
      method: "PATCH",
      query: queryString({ select: "*", id: `eq.${id}` }),
      body: memberPatchToRow(patch),
      headers: { Prefer: "return=representation" },
    });
    return rows[0] ? memberFromRow(rows[0]) : null;
  }

  async function deleteMember(id) {
    if (!supabase) {
      const db = await readLocalDb();
      const memberIndex = db.members.findIndex((member) => member.id === id);
      if (memberIndex === -1) return null;

      const [deletedMember] = db.members.splice(memberIndex, 1);
      const originalRequestCount = db.requests.length;
      db.requests = db.requests.filter((request) => request.memberId !== id);
      await writeLocalDb(db);

      return {
        deletedMember,
        deletedRequests: originalRequestCount - db.requests.length,
      };
    }

    const [memberRows, requestRows] = await Promise.all([
      supabaseRequest("vip_members", {
        query: queryString({ select: "*", id: `eq.${id}` }),
      }),
      supabaseRequest("vip_requests", {
        query: queryString({ select: "id", member_id: `eq.${id}` }),
      }),
    ]);

    if (!memberRows[0]) return null;

    await supabaseRequest("vip_members", {
      method: "DELETE",
      query: queryString({ id: `eq.${id}` }),
    });

    return {
      deletedMember: memberFromRow(memberRows[0]),
      deletedRequests: requestRows.length,
    };
  }

  async function listEvents({ visibleOnly = false } = {}) {
    if (!supabase) {
      const db = await readLocalDb();
      return visibleOnly ? db.events.filter((event) => event.visible !== false) : db.events;
    }

    const query = visibleOnly
      ? queryString({ select: "*", visible: "eq.true", order: "created_at.desc" })
      : queryString({ select: "*", order: "created_at.desc" });
    const rows = await supabaseRequest("vip_events", { query });
    return rows.map(eventFromRow);
  }

  async function createEvent(event) {
    if (!supabase) {
      const db = await readLocalDb();
      db.events.unshift(event);
      await writeLocalDb(db);
      return event;
    }

    const rows = await supabaseRequest("vip_events", {
      method: "POST",
      body: eventToRow(event),
      headers: { Prefer: "return=representation" },
    });
    return eventFromRow(rows[0]);
  }

  async function deleteEvent(id) {
    if (!supabase) {
      const db = await readLocalDb();
      const eventIndex = db.events.findIndex((event) => event.id === id);
      if (eventIndex === -1) return null;
      const [deletedEvent] = db.events.splice(eventIndex, 1);
      await writeLocalDb(db);
      return deletedEvent;
    }

    const rows = await supabaseRequest("vip_events", {
      method: "DELETE",
      query: queryString({ select: "*", id: `eq.${id}` }),
      headers: { Prefer: "return=representation" },
    });
    return rows[0] ? eventFromRow(rows[0]) : null;
  }

  async function listRequests() {
    if (!supabase) {
      const db = await readLocalDb();
      return db.requests;
    }

    const rows = await supabaseRequest("vip_requests", {
      query: queryString({ select: "*", order: "created_at.desc" }),
    });
    return rows.map(requestFromRow);
  }

  async function createRequest(request) {
    if (!supabase) {
      const db = await readLocalDb();
      db.requests.unshift(request);
      await writeLocalDb(db);
      return request;
    }

    const rows = await supabaseRequest("vip_requests", {
      method: "POST",
      body: requestToRow(request),
      headers: { Prefer: "return=representation" },
    });
    return requestFromRow(rows[0]);
  }

  async function updateRequestStatus(id, status) {
    if (!supabase) {
      const db = await readLocalDb();
      const request = db.requests.find((item) => item.id === id);
      if (!request) return null;
      request.status = status;
      await writeLocalDb(db);
      return request;
    }

    const rows = await supabaseRequest("vip_requests", {
      method: "PATCH",
      query: queryString({ select: "*", id: `eq.${id}` }),
      body: { status },
      headers: { Prefer: "return=representation" },
    });
    return rows[0] ? requestFromRow(rows[0]) : null;
  }

  async function readLocalDb() {
    await ensureDatabase();
    const raw = await readFile(dbPath, "utf8");
    const stored = JSON.parse(raw);
    return {
      ...seedDatabase,
      ...stored,
      members: stored.members || seedDatabase.members,
      events: stored.events || seedDatabase.events,
      requests: stored.requests || seedDatabase.requests,
    };
  }

  async function writeLocalDb(db) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);
  }

  async function supabaseRequest(table, { method = "GET", query = "", body, headers = {} } = {}) {
    const url = `${supabase.url}/rest/v1/${table}${query ? `?${query}` : ""}`;
    const response = await fetch(url, {
      method,
      headers: {
        apikey: supabase.key,
        Authorization: `Bearer ${supabase.key}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Supabase ${method} ${table} failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) return null;

  return {
    url: url.replace(/\/+$/, ""),
    key,
  };
}

function queryString(params) {
  return new URLSearchParams(params).toString();
}

function memberFromRow(row) {
  const name = displayNameFromParts({
    firstName: row.first_name,
    lastName: row.last_name,
    name: row.name,
  });
  return {
    id: row.id,
    firstName: row.first_name || firstNameFromName(name),
    lastName: row.last_name || lastNameFromName(name),
    name,
    cardName: row.card_name || name,
    email: row.email || "",
    phone: row.phone || "",
    city: row.city || "",
    memberId: row.member_id || "",
    joined: row.joined || "",
    status: row.status || "Unclaimed",
    claimedAt: row.claimed_at,
    passwordHash: row.password_hash || "",
    passwordSetAt: row.password_set_at || null,
    preferences: row.preferences || {},
  };
}

function memberToRow(member) {
  const name = displayNameFromParts(member);
  return {
    id: member.id,
    first_name: member.firstName || firstNameFromName(name),
    last_name: member.lastName || lastNameFromName(name),
    name,
    card_name: member.cardName || name,
    email: member.email || "",
    phone: member.phone || "",
    city: member.city || "",
    member_id: member.memberId || "",
    joined: member.joined || "",
    status: member.status || "Unclaimed",
    claimed_at: member.claimedAt || null,
    preferences: member.preferences || {},
  };
}

function memberPatchToRow(patch) {
  const row = {};
  if ("firstName" in patch) row.first_name = patch.firstName;
  if ("lastName" in patch) row.last_name = patch.lastName;
  if ("name" in patch) row.name = patch.name;
  if ("cardName" in patch) row.card_name = patch.cardName;
  if ("email" in patch) row.email = patch.email;
  if ("phone" in patch) row.phone = patch.phone;
  if ("city" in patch) row.city = patch.city;
  if ("memberId" in patch) row.member_id = patch.memberId;
  if ("joined" in patch) row.joined = patch.joined;
  if ("status" in patch) row.status = patch.status;
  if ("claimedAt" in patch) row.claimed_at = patch.claimedAt;
  if ("passwordHash" in patch) row.password_hash = patch.passwordHash;
  if ("passwordSetAt" in patch) row.password_set_at = patch.passwordSetAt;
  if ("preferences" in patch) row.preferences = patch.preferences;
  return row;
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

function eventFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    copy: row.copy,
    city: row.city,
    dateLabel: row.date_label,
    timeLabel: row.time_label,
    location: row.location,
    source: row.source,
    eventbriteUrl: row.eventbrite_url,
    image: row.image,
    visible: row.visible,
  };
}

function eventToRow(event) {
  return {
    id: event.id,
    title: event.title,
    copy: event.copy,
    city: event.city,
    date_label: event.dateLabel,
    time_label: event.timeLabel,
    location: event.location,
    source: event.source,
    eventbrite_url: event.eventbriteUrl,
    image: event.image,
    visible: event.visible !== false,
  };
}

function requestFromRow(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    type: row.type,
    message: row.message,
    emailTo: row.email_to,
    status: row.status,
    createdAt: row.created_at,
    emailStatus: row.email_status,
    emailSentAt: row.email_sent_at,
    emailError: row.email_error,
  };
}

function requestToRow(request) {
  return {
    id: request.id,
    member_id: request.memberId,
    member_name: request.memberName,
    type: request.type,
    message: request.message,
    email_to: request.emailTo,
    status: request.status,
    created_at: request.createdAt,
    email_status: request.emailStatus,
    email_sent_at: request.emailSentAt,
    email_error: request.emailError,
  };
}
