const sectionTitle = document.querySelector("#section-title");
const navButtons = document.querySelectorAll("[data-section-target]");
const sections = document.querySelectorAll(".admin-section");
const toast = document.querySelector(".toast");
const memberTable = document.querySelector("[data-member-table]");
const eventTable = document.querySelector("[data-event-table]");
const previewName = document.querySelector("[data-preview-name]");
const previewMember = document.querySelector("[data-preview-member]");
const importPreview = document.querySelector("[data-import-preview]");
const importCount = document.querySelector("[data-import-count]");
const runImportButton = document.querySelector("[data-run-import]");
const requestBoard = document.querySelector("[data-request-board]");
const perkList = document.querySelector("[data-perk-list]");
const perkForm = document.querySelector("[data-perk-form]");
const perkFormMode = document.querySelector("[data-perk-form-mode]");
const pushConfigPill = document.querySelector("[data-push-config-pill]");
const pushEnv = document.querySelector("[data-push-env]");
const pushBundle = document.querySelector("[data-push-bundle]");
const pushTeam = document.querySelector("[data-push-team]");
const pushKey = document.querySelector("[data-push-key]");
const pushTokenCount = document.querySelector("[data-push-token-count]");
const pushKeySource = document.querySelector("[data-push-key-source]");
const pushMissing = document.querySelector("[data-push-missing]");
const pushTokenSelect = document.querySelector("[data-push-token-select]");
const pushDeviceList = document.querySelector("[data-push-device-list]");
const pushSendButton = document.querySelector("[data-push-send-button]");
const pushTestResult = document.querySelector("[data-push-test-result]");
const adminThemeControls = document.querySelectorAll("[data-admin-theme-choice]");
const adminThemeColorMeta = document.querySelector('meta[name="theme-color"]');
const adminThemeStorageKey = "jcm-vip-admin-theme";
const adminThemeMedia = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let previewRecords = [];
let adminApiReady = false;
let toastTimer;

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "Request failed.");
    error.status = response.status;
    throw error;
  }

  return payload;
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function normalizeAdminThemePreference(preference) {
  return preference === "dark" || preference === "light" || preference === "system" ? preference : "system";
}

function getStoredAdminThemePreference() {
  try {
    return normalizeAdminThemePreference(localStorage.getItem(adminThemeStorageKey));
  } catch (error) {
    return "system";
  }
}

function resolveAdminTheme(preference) {
  const nextPreference = normalizeAdminThemePreference(preference);
  return nextPreference === "system" ? (adminThemeMedia?.matches ? "dark" : "light") : nextPreference;
}

function applyAdminThemePreference(preference, options = {}) {
  const nextPreference = normalizeAdminThemePreference(preference);
  const nextTheme = resolveAdminTheme(nextPreference);
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.dataset.themePreference = nextPreference;
  adminThemeColorMeta?.setAttribute("content", nextTheme === "dark" ? "#12110f" : "#f6f4ef");

  adminThemeControls.forEach((control) => {
    const isSelected = control.dataset.adminThemeChoice === nextPreference;
    control.setAttribute("aria-pressed", String(isSelected));
  });

  if (options.persist) {
    try {
      localStorage.setItem(adminThemeStorageKey, nextPreference);
    } catch (error) {
      // Local storage can be unavailable in private browsing contexts.
    }
  }

  if (options.notify) {
    const label = nextPreference === "system" ? "System appearance" : `${nextPreference === "dark" ? "Dark" : "Light"} mode`;
    showToast(`${label} on.`);
  }
}

applyAdminThemePreference(getStoredAdminThemePreference());

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("pause")) return "paused";
  if (normalized.includes("open")) return "open";
  if (normalized.includes("review")) return "review";
  if (normalized.includes("closed")) return "closed";
  return "active";
}

function displayMemberStatus(member, fallback = "Active") {
  const rawStatus = String(member.status || fallback || "Unclaimed").trim() || "Unclaimed";
  const isClaimed = Boolean(member.claimedAt || member.hasPassword || member.passwordSetAt);
  return isClaimed && rawStatus.toLowerCase() === "unclaimed" ? "Active" : rawStatus;
}

function renderSummary(summary) {
  const memberMetric = document.querySelector("[data-metric-members]");
  const requestMetric = document.querySelector("[data-metric-requests]");
  const eventMetric = document.querySelector("[data-metric-events]");
  const pushMetric = document.querySelector("[data-metric-push]");
  if (memberMetric) memberMetric.textContent = String(summary.activeMembers);
  if (requestMetric) requestMetric.textContent = String(summary.openRequests);
  if (eventMetric) eventMetric.textContent = String(summary.eventLinks);
  if (pushMetric) pushMetric.textContent = String(summary.pushDevices || 0);
}

function activateSection(target) {
  sections.forEach((section) => {
    section.classList.toggle("is-active", section.id === `section-${target}`);
  });

  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sectionTarget === target);
  });

  if (sectionTitle) {
    sectionTitle.textContent = target.charAt(0).toUpperCase() + target.slice(1);
  }
}

function previewCardName(name) {
  updatePreviewCard(name);
  showToast(`Previewing ${name}'s VIP card.`);
}

function updatePreviewCard(name) {
  if (previewName) previewName.textContent = name;
  if (previewMember) previewMember.textContent = name;
}

function nextMemberId() {
  const currentCount = memberTable?.querySelectorAll("tr").length || 0;
  return `JCM-VIP-${String(251 + currentCount).padStart(4, "0")}`;
}

function parseCsvRows(raw) {
  const rows = parseCsvTable(raw);

  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeCsvHeader);
  return rows.slice(1).map((values) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const firstName = csvValue(record, [
      "first_name",
      "firstname",
      "first",
      "given_name",
      "client_first_name",
      "contact_first_name",
    ]);
    const lastName = csvValue(record, [
      "last_name",
      "lastname",
      "last",
      "surname",
      "family_name",
      "client_last_name",
      "contact_last_name",
    ]);
    const fullName = csvValue(record, ["full_name", "fullname", "name", "client_name", "customer_name"]);
    const name = [firstName, lastName].filter(Boolean).join(" ").trim();
    return {
      firstName,
      lastName,
      name: name || fullName || "VIP Member",
      email: csvValue(record, ["email", "email_address", "emailaddress", "e_mail"]),
      phone: csvValue(record, ["phone", "phone_number", "phonenumber", "mobile", "mobile_phone"]),
      city: csvValue(record, ["city", "location", "market"]) || "Orlando",
      status: csvValue(record, ["status", "vip_status"]),
    };
  });
}

function normalizeCsvHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function csvValue(record, aliases) {
  for (const alias of aliases) {
    const value = record[normalizeCsvHeader(alias)];
    if (value) return value;
  }
  return "";
}

function parseCsvTable(raw) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const input = String(raw || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const nextChar = input[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function getImportCsvText(form) {
  const data = new FormData(form);
  const csvFile = data.get("csvFile");

  if (csvFile instanceof File && csvFile.size > 0) {
    return csvFile.text();
  }

  return String(data.get("csvRows") || "");
}

function displayMemberName(member) {
  const joinedName = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
  return joinedName || member.name || "VIP Member";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addMemberRow(member, status = "Active", placement = "prepend") {
  if (!memberTable) return;
  const { email, city, memberId = nextMemberId() } = member;
  const name = displayMemberName(member);
  const visibleStatus = displayMemberStatus(member, status);
  const row = document.createElement("tr");
  row.dataset.memberId = member.id || "";
  row.dataset.memberName = name;
  row.innerHTML = `
    <td><strong></strong><small></small></td>
    <td></td>
    <td></td>
    <td><span class="status-pill active"></span></td>
    <td>
      <div class="row-actions">
        <button type="button" data-preview-member-action>Preview</button>
        <button class="danger-button" type="button" data-delete-member>Delete</button>
      </div>
    </td>
  `;
  row.querySelector("strong").textContent = name;
  row.querySelector("small").textContent = city || "Orlando";
  row.children[1].textContent = email || "missing email";
  row.children[2].textContent = memberId;
  const pill = row.querySelector(".status-pill");
  pill.textContent = visibleStatus;
  pill.className = `status-pill ${statusClass(visibleStatus)}`;
  row.querySelector("[data-preview-member-action]").addEventListener("click", () => previewCardName(name));
  row.querySelector("[data-delete-member]").addEventListener("click", () => deleteMember(row));
  if (placement === "append") {
    memberTable.append(row);
  } else {
    memberTable.prepend(row);
  }
}

function renderMembers(members) {
  if (!memberTable || !Array.isArray(members)) return;
  memberTable.innerHTML = "";
  members.forEach((member) => addMemberRow(member, member.status, "append"));
  const firstMember = members[0];
  if (firstMember) {
    updatePreviewCard(firstMember.cardName || firstMember.name);
  } else {
    updatePreviewCard("No member selected");
  }
}

function renderEvents(events) {
  if (!eventTable || !Array.isArray(events)) return;
  eventTable.innerHTML = "";

  events.forEach((event) => {
    const row = document.createElement("tr");
    row.dataset.eventId = event.id || "";
    row.dataset.eventName = event.title || "VIP Event";
    row.innerHTML = `
      <td><strong></strong><small></small></td>
      <td></td>
      <td></td>
      <td><span class="status-pill"></span></td>
      <td><button class="danger-button" type="button" data-delete-event>Delete</button></td>
    `;
    row.querySelector("strong").textContent = event.title || "VIP Event";
    row.querySelector("small").textContent = String(event.eventbriteUrl || "")
      .replace(/^https?:\/\//, "")
      .slice(0, 42);
    row.children[1].textContent = event.dateLabel || "TBD";
    row.children[2].textContent = event.location || event.city || "Orlando";
    const pill = row.querySelector(".status-pill");
    pill.textContent = event.visible === false ? "Hidden" : "Visible";
    pill.className = `status-pill ${event.visible === false ? "paused" : "active"}`;
    row.querySelector("[data-delete-event]").addEventListener("click", () => deleteEvent(row));
    eventTable.append(row);
  });
}

function renderPerks(perks) {
  if (!perkList || !Array.isArray(perks)) return;
  perkList.innerHTML = "";

  if (perks.length === 0) {
    perkList.innerHTML = "<p>No perks have been added yet.</p>";
    return;
  }

  perks.forEach((perk) => {
    const article = document.createElement("article");
    article.className = `accent-${perk.accent || "red"}`;
    article.dataset.perkId = perk.id || "";
    article.innerHTML = `
      <i data-lucide="${escapeHtml(perk.icon || "star")}" aria-hidden="true"></i>
      <div>
        <strong>${escapeHtml(perk.title || "VIP Perk")}</strong>
        <p>${escapeHtml(perk.description || "VIP member perk.")}</p>
        <small>${escapeHtml([perk.note, perk.buttonLabel, perk.actionUrl ? "link" : "message"].filter(Boolean).join(" · "))}</small>
      </div>
      <div class="row-actions">
        <button type="button" data-edit-perk="${escapeHtml(perk.id || "")}">Edit</button>
        <button type="button" data-toggle-perk="${escapeHtml(perk.id || "")}">
          ${perk.visible === false ? "Hidden" : "Visible"}
        </button>
        <button class="danger-button" type="button" data-delete-perk="${escapeHtml(perk.id || "")}">
          Delete
        </button>
      </div>
    `;
    article.dataset.perk = JSON.stringify(perk);
    article.querySelector("[data-edit-perk]").addEventListener("click", () => editPerk(perk));
    article.querySelector("[data-toggle-perk]").addEventListener("click", () => togglePerk(perk));
    article.querySelector("[data-delete-perk]").addEventListener("click", () => deletePerk(perk));
    perkList.append(article);
  });

  if (window.lucide) window.lucide.createIcons();
}

function resetPerkForm() {
  if (!perkForm) return;
  perkForm.reset();
  perkForm.elements.perkId.value = "";
  perkForm.elements.title.value = "Private group";
  perkForm.elements.description.value = "Access the members-only Just Call Moe VIP Facebook community.";
  perkForm.elements.note.value = "Members-only access";
  perkForm.elements.buttonLabel.value = "Join";
  perkForm.elements.icon.value = "users";
  perkForm.elements.accent.value = "green";
  perkForm.elements.actionUrl.value = "https://www.facebook.com/share/g/1B5JVZj46a/";
  perkForm.elements.actionMessage.value = "";
  perkForm.elements.visible.checked = true;
  if (perkFormMode) perkFormMode.textContent = "Add Perk";
}

function editPerk(perk) {
  if (!perkForm) return;
  perkForm.elements.perkId.value = perk.id || "";
  perkForm.elements.title.value = perk.title || "";
  perkForm.elements.description.value = perk.description || "";
  perkForm.elements.note.value = perk.note || "";
  perkForm.elements.buttonLabel.value = perk.buttonLabel || "View";
  perkForm.elements.icon.value = perk.icon || "star";
  perkForm.elements.accent.value = perk.accent || "red";
  perkForm.elements.actionUrl.value = perk.actionUrl || "";
  perkForm.elements.actionMessage.value = perk.actionMessage || "";
  perkForm.elements.visible.checked = perk.visible !== false;
  if (perkFormMode) perkFormMode.textContent = "Edit Perk";
  perkForm.querySelector("input[name='title']")?.focus();
}

function perkPayloadFromForm(form) {
  const data = new FormData(form);
  return {
    title: String(data.get("title") || ""),
    description: String(data.get("description") || ""),
    note: String(data.get("note") || ""),
    icon: String(data.get("icon") || "star"),
    accent: String(data.get("accent") || "red"),
    buttonLabel: String(data.get("buttonLabel") || "View"),
    actionUrl: String(data.get("actionUrl") || ""),
    actionMessage: String(data.get("actionMessage") || ""),
    visible: data.get("visible") === "on",
  };
}

async function togglePerk(perk) {
  if (!adminApiReady || !perk.id) return;
  try {
    const result = await apiRequest(`/api/admin/perks/${encodeURIComponent(perk.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ visible: perk.visible === false }),
    });
    renderPerks(result.perks);
    showToast(`${perk.title || "Perk"} ${perk.visible === false ? "shown" : "hidden"}.`);
  } catch (error) {
    showToast(error.message || "Perk visibility could not be saved.");
  }
}

async function deletePerk(perk) {
  if (!adminApiReady || !perk.id) return;
  const confirmed = window.confirm(`Delete ${perk.title || "this perk"} from the member app?`);
  if (!confirmed) return;

  try {
    const result = await apiRequest(`/api/admin/perks/${encodeURIComponent(perk.id)}`, {
      method: "DELETE",
    });
    renderPerks(result.perks);
    resetPerkForm();
    showToast("Perk deleted.");
  } catch (error) {
    showToast(error.message || "Perk could not be deleted.");
  }
}

async function deleteMember(row) {
  const memberId = row.dataset.memberId;
  const memberName = row.dataset.memberName || row.querySelector("strong")?.textContent || "this VIP";
  const confirmed = window.confirm(`Delete ${memberName} from the VIP member list? This also removes their concierge requests.`);
  if (!confirmed) return;

  if (adminApiReady && memberId) {
    try {
      const result = await apiRequest(`/api/admin/members/${encodeURIComponent(memberId)}`, {
        method: "DELETE",
      });
      renderMembers(result.members);
      renderRequests(result.requests);
      renderSummary(result.summary);
      showToast(`${memberName} deleted.`);
      return;
    } catch (error) {
      showToast(error.message || "VIP member could not be deleted.");
      return;
    }
  }

  row.remove();
  const metric = document.querySelector("[data-metric-members]");
  if (metric) metric.textContent = String(Math.max(0, Number(metric.textContent) - 1));
  showToast(`${memberName} deleted.`);
}

async function deleteEvent(row) {
  const eventId = row.dataset.eventId;
  const eventName = row.dataset.eventName || row.querySelector("strong")?.textContent || "this event";
  const confirmed = window.confirm(`Delete ${eventName} from the Eventbrite listings?`);
  if (!confirmed) return;

  if (adminApiReady && eventId) {
    try {
      const result = await apiRequest(`/api/admin/events/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
      });
      renderEvents(result.events);
      renderSummary(result.summary);
      showToast(`${eventName} deleted.`);
      return;
    } catch (error) {
      showToast(error.message || "Event could not be deleted.");
      return;
    }
  }

  row.remove();
  const metric = document.querySelector("[data-metric-events]");
  if (metric) metric.textContent = String(Math.max(0, Number(metric.textContent) - 1));
  showToast(`${eventName} deleted.`);
}

function renderRequests(requests) {
  if (!requestBoard || !Array.isArray(requests)) return;
  requestBoard.innerHTML = "";

  requests.forEach((request) => {
    const article = document.createElement("article");
    article.dataset.requestId = request.id;
    article.innerHTML = `
      <span class="status-pill"></span>
      <div>
        <strong></strong>
        <p></p>
      </div>
      <select data-request-status>
        <option>Open</option>
        <option>In review</option>
        <option>Closed</option>
      </select>
    `;
    const chip = article.querySelector(".status-pill");
    chip.textContent = request.status || "Open";
    chip.className = `status-pill ${statusClass(request.status)}`;
    article.querySelector("strong").textContent = request.memberName || "VIP Member";
    article.querySelector("p").textContent = request.message || request.type || "VIP request";
    const select = article.querySelector("select");
    select.value = request.status || "Open";
    requestBoard.append(article);
  });

  bindRequestStatusControls();
}

function renderPushAdmin(payload = {}) {
  const apns = payload.apns || {};
  const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
  const isConfigured = Boolean(apns.configured);

  if (pushConfigPill) {
    pushConfigPill.textContent = isConfigured ? "Ready" : "Needs setup";
    pushConfigPill.className = `status-pill ${isConfigured ? "active" : "open"}`;
  }
  if (pushEnv) pushEnv.textContent = apns.environment || "sandbox";
  if (pushBundle) pushBundle.textContent = apns.bundleId || "com.justcallmoe.vipapp";
  if (pushTeam) pushTeam.textContent = apns.teamId || "Missing";
  if (pushKey) pushKey.textContent = apns.keyId || "Missing";
  if (pushTokenCount) pushTokenCount.textContent = String(tokens.length);
  if (pushKeySource) pushKeySource.textContent = apns.privateKeySource || "Missing";
  if (pushMissing) {
    const missing = Array.isArray(apns.missing) ? apns.missing : [];
    pushMissing.textContent = missing.length
      ? `Missing: ${missing.join(", ")}`
      : "APNs is configured. Send one test push before inviting beta users.";
  }

  if (pushTokenSelect) {
    pushTokenSelect.innerHTML = "";
    if (tokens.length === 0) {
      pushTokenSelect.append(new Option("No registered devices yet", ""));
    } else {
      tokens.forEach((token) => {
        const owner = token.memberName || token.memberEmail || token.memberId || "VIP device";
        const label = `${owner} · ${token.tokenPreview || "registered"}`;
        pushTokenSelect.append(new Option(label, token.id || ""));
      });
    }
    pushTokenSelect.disabled = tokens.length === 0;
  }

  if (pushSendButton) {
    pushSendButton.disabled = !isConfigured || tokens.length === 0;
  }

  renderPushDevices(tokens);
}

function renderPushDevices(tokens) {
  if (!pushDeviceList) return;

  if (!tokens.length) {
    pushDeviceList.innerHTML = "<p>No registered iPhones yet.</p>";
    return;
  }

  pushDeviceList.innerHTML = tokens
    .map((token) => {
      const owner = escapeHtml(token.memberName || token.memberEmail || token.memberId || "VIP device");
      const details = [
        token.platform || "ios",
        token.environment || "",
        token.tokenPreview || "registered",
        token.lastRegisteredAt ? `Registered ${formatDateTime(token.lastRegisteredAt)}` : "",
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" · ");
      return `
        <article>
          <div>
            <strong>${owner}</strong>
            <small>${details}</small>
          </div>
          <div class="push-device-actions">
            <span class="status-pill active">Enabled</span>
            <button class="danger-button compact" type="button" data-delete-push-token="${escapeHtml(token.id || "")}" data-push-owner="${owner}">
              Delete
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  pushDeviceList.querySelectorAll("[data-delete-push-token]").forEach((button) => {
    button.addEventListener("click", () => deletePushToken(button));
  });
}

async function deletePushToken(button) {
  const tokenId = button.dataset.deletePushToken;
  const owner = button.dataset.pushOwner || "this push device";
  if (!tokenId) return;

  const confirmed = window.confirm(`Delete the push device for ${owner}?`);
  if (!confirmed) return;

  button.disabled = true;
  try {
    const result = await apiRequest(`/api/admin/push-tokens/${encodeURIComponent(tokenId)}`, {
      method: "DELETE",
    });
    renderPushAdmin(result);
    if (result.summary) renderSummary(result.summary);
    showToast("Push device deleted.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message || "Push device could not be deleted.");
  }
}

function renderPushError(error) {
  if (pushConfigPill) {
    pushConfigPill.textContent = "Error";
    pushConfigPill.className = "status-pill error";
  }
  if (pushMissing) pushMissing.textContent = error.message || "Push status could not be loaded.";
  if (pushSendButton) pushSendButton.disabled = true;
}

async function loadPushAdminStatus() {
  try {
    const payload = await apiRequest("/api/admin/push/status");
    renderPushAdmin(payload);
    return payload;
  } catch (error) {
    renderPushError(error);
    return null;
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function bindRequestStatusControls() {
  document.querySelectorAll("[data-request-status]").forEach((select) => {
    if (select.dataset.bound === "true") return;
    select.dataset.bound = "true";
    select.addEventListener("change", async () => {
      const card = select.closest("article");
      const chip = card?.querySelector(".status-pill");
      const value = select.value;
      if (!chip) return;
      chip.textContent = value;
      chip.className = `status-pill ${statusClass(value)}`;

      if (adminApiReady && card?.dataset.requestId) {
        try {
          const result = await apiRequest(`/api/admin/requests/${encodeURIComponent(card.dataset.requestId)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: value }),
          });
          renderSummary(result.summary);
        } catch (error) {
          showToast(error.message || "Request status could not be saved.");
          return;
        }
      }

      showToast(`Request marked ${value.toLowerCase()}.`);
    });
  });
}

function showAdminLogin() {
  if (document.querySelector("[data-admin-login]")) return;

  const overlay = document.createElement("section");
  overlay.className = "admin-login-overlay";
  overlay.dataset.adminLogin = "true";
  overlay.innerHTML = `
    <form class="admin-login-card" data-admin-login-form>
      <img src="https://justcallmoe.com/wp-content/uploads/2026/03/jcm-logo-opt.webp" alt="Just Call Moe">
      <p class="eyebrow">VIP Admin</p>
      <h2>Sign In</h2>
      <label>
        Admin password
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button class="primary-button" type="submit">Open Dashboard</button>
      <p class="fine-print" data-admin-login-message></p>
    </form>
  `;

  document.body.append(overlay);
  overlay.querySelector("input")?.focus();
  overlay.querySelector("[data-admin-login-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") || "");
    const message = form.querySelector("[data-admin-login-message]");

    try {
      await apiRequest("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      overlay.remove();
      await loadAdminData();
    } catch (error) {
      if (message) message.textContent = error.message || "Admin login failed.";
    }
  });
}

async function loadAdminData() {
  try {
    const summary = await apiRequest("/api/admin/summary");
    adminApiReady = true;
    renderSummary(summary.summary);

    const [members, events, perks, requests, push] = await Promise.all([
      apiRequest("/api/admin/members"),
      apiRequest("/api/admin/events"),
      apiRequest("/api/admin/perks"),
      apiRequest("/api/admin/requests"),
      apiRequest("/api/admin/push/status"),
    ]);
    renderMembers(members.members);
    renderEvents(events.events);
    renderPerks(perks.perks);
    renderRequests(requests.requests);
    renderPushAdmin(push);
  } catch (error) {
    if (error.status === 401) {
      adminApiReady = false;
      showAdminLogin();
      return;
    }

    adminApiReady = false;
  }
}

function renderImportPreview(records) {
  if (!importPreview || !importCount || !runImportButton) return;

  previewRecords = records;
  importCount.textContent = `${records.length} ${records.length === 1 ? "record" : "records"}`;
  runImportButton.disabled = records.length === 0;

  if (records.length === 0) {
    importPreview.innerHTML = "<p>No rows found. Paste CSV rows or connect a Google Sheet.</p>";
    return;
  }

  const rows = records
    .slice(0, 5)
    .map(
      (record) => `
        <tr>
          <td>${escapeHtml(displayMemberName(record))}</td>
          <td>${escapeHtml(record.email || "Missing")}</td>
          <td>${escapeHtml(record.city)}</td>
          <td>${escapeHtml(record.status || "Default")}</td>
        </tr>
      `
    )
    .join("");

  importPreview.innerHTML = `
    <div class="table-wrap">
      <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>City</th>
              <th>Status</th>
            </tr>
          </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateSection(button.dataset.sectionTarget);
  });
});

document.querySelectorAll("[data-section-shortcut]").forEach((button) => {
  button.addEventListener("click", () => {
    activateSection(button.dataset.sectionShortcut);
  });
});

document.querySelectorAll("[data-open-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = document.getElementById(button.dataset.openDialog);
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  });
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = button.closest("dialog");
    if (!dialog) return;
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  });
});

document.querySelector("[data-member-search]")?.addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  memberTable?.querySelectorAll("tr").forEach((row) => {
    row.hidden = !row.textContent.toLowerCase().includes(query);
  });
});

document.querySelector("[data-member-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const email = String(data.get("email") || "").trim();
  const location = String(data.get("location") || "Orlando").trim();
  if (!name || !email || !memberTable) return;

  if (adminApiReady) {
    try {
      const result = await apiRequest("/api/admin/members", {
        method: "POST",
        body: JSON.stringify({ name, email, city: location, status: "Active" }),
      });
      addMemberRow(result.member, result.member.status);
      renderSummary(result.summary);
    } catch (error) {
      showToast(error.message || "VIP member could not be added.");
      return;
    }
  } else {
    addMemberRow({ name, email, city: location }, "Active");

    const metric = document.querySelector("[data-metric-members]");
    if (metric) metric.textContent = String(Number(metric.textContent) + 1);
  }

  previewCardName(name);
  showToast(`${name} added as a VIP member.`);
  form.reset();
  const dialog = form.closest("dialog");
  if (dialog?.close) dialog.close();
});

document.querySelectorAll("[data-preview-member-row]").forEach((button) => {
  button.addEventListener("click", () => {
    previewCardName(button.dataset.previewMemberRow);
  });
});

document.querySelectorAll("[data-delete-member]").forEach((button) => {
  if (button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    const row = button.closest("tr");
    if (row) deleteMember(row);
  });
});

document.querySelectorAll("[data-delete-event]").forEach((button) => {
  if (button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    const row = button.closest("tr");
    if (row) deleteEvent(row);
  });
});

document.querySelector("[data-import-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const sheetUrl = String(data.get("sheetUrl") || "").trim();
  let csvRows = "";

  try {
    csvRows = await getImportCsvText(form);
  } catch (error) {
    showToast("CSV file could not be read.");
    return;
  }

  let records = parseCsvRows(csvRows);

  if (records.length === 0 && sheetUrl) {
    records = [
      { firstName: "Taylor", lastName: "Brooks", name: "Taylor Brooks", email: "taylor@example.com", city: "Orlando" },
      { firstName: "Morgan", lastName: "Lee", name: "Morgan Lee", email: "morgan@example.com", city: "Tampa" },
      { firstName: "Casey", lastName: "Nguyen", name: "Casey Nguyen", email: "casey@example.com", city: "West Palm Beach" },
    ];
  }

  renderImportPreview(records);
  showToast(`${records.length} VIP records ready to import.`);
});

runImportButton?.addEventListener("click", async () => {
  if (previewRecords.length === 0) return;
  const status = document.querySelector("[data-import-form] select[name='status']")?.value || "Active";

  if (adminApiReady) {
    try {
      const result = await apiRequest("/api/admin/import", {
        method: "POST",
        body: JSON.stringify({ records: previewRecords, status }),
      });
      renderMembers(result.members);
      renderSummary(result.summary);
      showToast(`${result.imported.length} VIP records imported. ${result.skipped.length} skipped.`);
      activateSection("members");
      return;
    } catch (error) {
      showToast(error.message || "Import could not be completed.");
      return;
    }
  }

  previewRecords.slice(0, 25).forEach((record) => addMemberRow(record, status));
  const metric = document.querySelector("[data-metric-members]");
  if (metric) metric.textContent = String(Number(metric.textContent) + previewRecords.length);
  showToast(`${previewRecords.length} VIP records imported.`);
  activateSection("members");
});

perkForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = perkPayloadFromForm(form);
  if (!payload.title.trim()) {
    showToast("Perk title is required.");
    return;
  }

  const perkId = String(new FormData(form).get("perkId") || "");
  try {
    const result = await apiRequest(perkId ? `/api/admin/perks/${encodeURIComponent(perkId)}` : "/api/admin/perks", {
      method: perkId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    renderPerks(result.perks);
    resetPerkForm();
    showToast(perkId ? "Perk updated." : "Perk added.");
  } catch (error) {
    showToast(error.message || "Perk could not be saved.");
  }
});

document.querySelector("[data-perk-reset]")?.addEventListener("click", () => {
  resetPerkForm();
});

document.querySelector("[data-event-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get("eventName") || "").trim();
  const url = String(data.get("eventUrl") || "").trim();
  const date = String(data.get("eventDate") || "").trim();
  const location = String(data.get("eventLocation") || "").trim();
  if (!name || !url || !eventTable) return;

  if (adminApiReady) {
    try {
      const result = await apiRequest("/api/admin/events", {
        method: "POST",
        body: JSON.stringify({
          title: name,
          eventbriteUrl: url,
          dateLabel: date,
          location,
          copy: String(data.get("eventCopy") || "").trim(),
        }),
      });
      renderEvents(result.events);
      renderSummary(result.summary);
      showToast("Eventbrite link published.");
      form.reset();
      return;
    } catch (error) {
      showToast(error.message || "Eventbrite link could not be saved.");
      return;
    }
  }

  const row = document.createElement("tr");
  row.dataset.eventName = name;
  row.innerHTML = `
    <td><strong></strong><small></small></td>
    <td></td>
    <td></td>
    <td><span class="status-pill active">Visible</span></td>
    <td><button class="danger-button" type="button" data-delete-event>Delete</button></td>
  `;
  row.querySelector("strong").textContent = name;
  row.querySelector("small").textContent = url.replace(/^https?:\/\//, "").slice(0, 42);
  row.children[1].textContent = date;
  row.children[2].textContent = location;
  row.querySelector("[data-delete-event]").addEventListener("click", () => deleteEvent(row));
  eventTable.prepend(row);

  const metric = document.querySelector("[data-metric-events]");
  if (metric) metric.textContent = String(Number(metric.textContent) + 1);
  showToast("Eventbrite link published.");
});

document.querySelector("[data-add-event]")?.addEventListener("click", () => {
  document.querySelector("[data-event-form] input[name='eventName']")?.focus();
});

document.querySelectorAll("[data-toggle-row]").forEach((button) => {
  button.addEventListener("click", () => {
    const isVisible = button.textContent.trim() === "Visible";
    button.textContent = isVisible ? "Hidden" : "Visible";
    showToast(`Perk ${isVisible ? "hidden" : "visible"}.`);
  });
});

bindRequestStatusControls();

document.querySelector("[data-request-filter]")?.addEventListener("change", (event) => {
  const value = event.target.value;
  document.querySelectorAll("[data-request-board] article").forEach((item) => {
    const status = item.querySelector(".status-pill")?.textContent || "";
    item.hidden = value !== "All requests" && status !== value;
  });
});

adminThemeControls.forEach((control) => {
  control.addEventListener("click", () => {
    applyAdminThemePreference(control.dataset.adminThemeChoice, { persist: true, notify: true });
  });
});

if (adminThemeMedia) {
  const syncSystemAdminTheme = () => {
    if (document.documentElement.dataset.themePreference === "system") {
      applyAdminThemePreference("system");
    }
  };

  if (typeof adminThemeMedia.addEventListener === "function") {
    adminThemeMedia.addEventListener("change", syncSystemAdminTheme);
  } else if (typeof adminThemeMedia.addListener === "function") {
    adminThemeMedia.addListener(syncSystemAdminTheme);
  }
}

document.querySelector("[data-refresh-push]")?.addEventListener("click", async () => {
  await loadPushAdminStatus();
  showToast("Push status refreshed.");
});

document.querySelector("[data-push-test-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);

  if (pushSendButton) pushSendButton.disabled = true;
  if (pushTestResult) {
    pushTestResult.textContent = "Sending test push...";
    pushTestResult.className = "fine-print neutral";
  }

  try {
    const result = await apiRequest("/api/admin/push/send-test", {
      method: "POST",
      body: JSON.stringify({
        tokenId: String(data.get("tokenId") || ""),
        title: String(data.get("title") || ""),
        message: String(data.get("message") || ""),
      }),
    });

    if (pushTestResult) {
      pushTestResult.textContent = `${result.message} APNs ID: ${result.result?.apnsId || "accepted"}.`;
      pushTestResult.className = "fine-print neutral";
    }
    showToast("Test push sent.");
    await loadPushAdminStatus();
  } catch (error) {
    if (pushTestResult) {
      pushTestResult.textContent = error.message || "Test push could not be sent.";
      pushTestResult.className = "fine-print";
    }
    showToast(error.message || "Test push could not be sent.");
    await loadPushAdminStatus();
  }
});

document.querySelector("[data-export]")?.addEventListener("click", () => {
  showToast("Beta export prepared.");
});

window.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
  loadAdminData();
});
