const viewTitle = document.querySelector("#view-title");
const navItems = document.querySelectorAll("[data-view-target]");
const views = document.querySelectorAll(".view");
const toast = document.querySelector(".toast");
const conciergeForms = document.querySelectorAll("[data-concierge-form]");
const cardNameInput = document.querySelector("[data-name-input]");
const etchedName = document.querySelector(".etched-name");
const avatar = document.querySelector(".avatar");
const appScreen = document.querySelector(".app-screen");
const appLoader = document.querySelector("[data-app-loader]");
const claimForm = document.querySelector("[data-claim-form]");
const codeForm = document.querySelector("[data-code-form]");
const claimMessage = document.querySelector("[data-claim-message]");
const codeMessage = document.querySelector("[data-code-message]");
const memberLogoutButtons = document.querySelectorAll("[data-member-logout]");
const eventsList = document.querySelector("[data-events-list]");
const perksList = document.querySelector("[data-perks-list]");
const nextEventTitle = document.querySelector("[data-next-event-title]");
const nextEventMeta = document.querySelector("[data-next-event-meta]");
const pushEnableButton = document.querySelector("[data-push-enable]");
const pushStatus = document.querySelector("[data-push-status]");
const pushLabel = document.querySelector("[data-push-label]");
const themeToggles = document.querySelectorAll("[data-theme-toggle]");
const themeControls = document.querySelectorAll("[data-theme-choice]");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const conciergeEmail = "vip@justcallmoe.com";
const demoCode = "246810";
const nativeApiBaseUrl = "https://vip-app-091y.onrender.com";
const themeStorageKey = "jcm-vip-theme";
const memberSessionStorageKey = "jcm-vip-session";
const pushTokenStorageKey = "jcm-vip-push-token";
const themeMedia = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const demoMembers = [
  {
    name: "Avery Mitchell",
    email: "avery@example.com",
    phone: "4075550188",
    memberId: "JCM-VIP-0248",
    joined: "2024",
  },
  {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "4075550199",
    memberId: "JCM-VIP-0249",
    joined: "2025",
  },
  {
    name: "Sam Carter",
    email: "sam@example.com",
    phone: "4075550177",
    memberId: "JCM-VIP-0250",
    joined: "2024",
  },
];
let pendingMember = null;
let pendingClaim = null;
let activeMember = null;
let betaApiReady = false;
let toastTimer;
let pushListenersAttached = false;
let appLaunchFinished = false;

function normalizeThemePreference(preference) {
  return preference === "dark" || preference === "light" || preference === "system" ? preference : "system";
}

function getStoredThemePreference() {
  try {
    return normalizeThemePreference(localStorage.getItem(themeStorageKey));
  } catch (error) {
    return "system";
  }
}

function resolveTheme(preference) {
  const nextPreference = normalizeThemePreference(preference);
  return nextPreference === "system" ? (themeMedia?.matches ? "dark" : "light") : nextPreference;
}

function syncNativeTheme(theme) {
  try {
    window.webkit?.messageHandlers?.nativeTheme?.postMessage(theme);
  } catch (error) {
    // The browser build does not expose the iOS message handler.
  }
}

function applyThemePreference(preference, options = {}) {
  const nextPreference = normalizeThemePreference(preference);
  const nextTheme = resolveTheme(nextPreference);
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.dataset.themePreference = nextPreference;
  themeColorMeta?.setAttribute("content", nextTheme === "dark" ? "#141312" : "#f7f3ea");
  syncNativeTheme(nextTheme);

  const isDark = nextTheme === "dark";
  themeToggles.forEach((toggle) => {
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.setAttribute("aria-label", isDark ? "Turn on light mode" : "Turn on dark mode");
  });
  themeControls.forEach((control) => {
    const isSelected = control.dataset.themeChoice === nextPreference;
    control.setAttribute("aria-pressed", String(isSelected));
  });

  if (options.persist) {
    try {
      localStorage.setItem(themeStorageKey, nextPreference);
    } catch (error) {
      // Local storage can be unavailable in private browsing contexts.
    }
  }

  if (options.notify) {
    const label = nextPreference === "system" ? "System appearance" : `${nextPreference === "dark" ? "Dark" : "Light"} mode`;
    showToast(`${label} on.`);
  }
}

applyThemePreference(getStoredThemePreference());

function isNativeShell() {
  return (
    window.Capacitor?.isNativePlatform?.() ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:"
  );
}

if (isNativeShell()) {
  document.documentElement.classList.add("native-shell");
}

function apiUrl(path) {
  if (isNativeShell() && path.startsWith("/")) {
    return `${nativeApiBaseUrl}${path}`;
  }

  return path;
}

function normalizeExternalUrl(value) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) return "";

  const hasProtocol = /^[a-z][a-z\d+\-.]*:/i.test(rawUrl);
  const candidate = hasProtocol ? rawUrl : `https://${rawUrl}`;

  try {
    const url = new URL(candidate);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function openExternalUrl(event, url) {
  const href = normalizeExternalUrl(url);
  if (!href) return;

  if (!isNativeShell()) return;

  event.preventDefault();
  try {
    window.webkit?.messageHandlers?.externalLink?.postMessage(href);
    return;
  } catch (error) {
    // Fall back to browser behavior when the native shell has not installed the bridge.
  }

  const openedWindow = window.open(href, "_blank", "noopener,noreferrer");
  if (!openedWindow) {
    window.location.href = href;
  }
}

function getStoredMemberSession() {
  try {
    return localStorage.getItem(memberSessionStorageKey) || "";
  } catch (error) {
    return "";
  }
}

function storeMemberSession(sessionToken) {
  if (!sessionToken) return;

  try {
    localStorage.setItem(memberSessionStorageKey, sessionToken);
  } catch (error) {
    // Local storage can be unavailable in private browsing contexts.
  }
}

function clearStoredMemberSession() {
  try {
    localStorage.removeItem(memberSessionStorageKey);
  } catch (error) {
    // Local storage can be unavailable in private browsing contexts.
  }
}

function getStoredPushToken() {
  try {
    return localStorage.getItem(pushTokenStorageKey) || "";
  } catch (error) {
    return "";
  }
}

function storePushToken(tokenValue) {
  if (!tokenValue) return;

  try {
    localStorage.setItem(pushTokenStorageKey, tokenValue);
  } catch (error) {
    // Local storage can be unavailable in private browsing contexts.
  }
}

function clearStoredPushToken() {
  try {
    localStorage.removeItem(pushTokenStorageKey);
  } catch (error) {
    // Local storage can be unavailable in private browsing contexts.
  }
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const sessionToken = getStoredMemberSession();
  if (sessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: isNativeShell() ? "include" : "same-origin",
    headers,
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
  }, 2600);
}

function finishAppLaunch() {
  if (appLaunchFinished) return;
  appLaunchFinished = true;
  appLoader?.classList.add("is-hidden");
  window.setTimeout(() => {
    if (appLaunchFinished) {
      appLoader?.setAttribute("hidden", "");
    }
  }, 220);
}

function getPushPlugin() {
  const capacitor = window.Capacitor;
  if (!capacitor) return null;

  if (!capacitor.Plugins?.PushNotifications && typeof capacitor.registerPlugin === "function") {
    capacitor.registerPlugin("PushNotifications", {});
  }

  return capacitor.Plugins?.PushNotifications || null;
}

function pushPlatform() {
  return window.Capacitor?.getPlatform?.() || (isNativeShell() ? "ios" : "web");
}

function pushDeviceLabel() {
  return [navigator.platform, navigator.userAgent]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 160);
}

function updatePushSetting(state = "idle", message) {
  if (!pushEnableButton || !pushStatus || !pushLabel) return;

  const pushPlugin = getPushPlugin();
  const nativeShell = isNativeShell();
  const states = {
    web: {
      label: "iPhone",
      copy: "Available once this is running as the iPhone app.",
      disabled: true,
      enabled: false,
    },
    missing: {
      label: "Rebuild",
      copy: "Rebuild the iPhone app before testing notifications.",
      disabled: true,
      enabled: false,
    },
    signedOut: {
      label: "Enable",
      copy: "Sign in before enabling event reminders.",
      disabled: true,
      enabled: false,
    },
    checking: {
      label: "Checking",
      copy: "Checking this device's notification status...",
      disabled: true,
      enabled: false,
    },
    registering: {
      label: "Saving",
      copy: "Waiting for the iPhone to finish notification setup...",
      disabled: true,
      enabled: false,
    },
    enabled: {
      label: "On",
      copy: "This device is registered for VIP notifications.",
      disabled: false,
      enabled: true,
    },
    denied: {
      label: "Enable",
      copy: "Notifications are off for this app in iPhone Settings.",
      disabled: false,
      enabled: false,
    },
    error: {
      label: "Retry",
      copy: "Notifications could not be enabled. Try again.",
      disabled: false,
      enabled: false,
    },
    idle: {
      label: "Enable",
      copy: "Turn on event reminders and VIP notices for this device.",
      disabled: false,
      enabled: false,
    },
  };

  let nextState = state;
  if (!nativeShell) nextState = "web";
  else if (!pushPlugin) nextState = "missing";
  else if (!activeMember) nextState = "signedOut";

  const setting = states[nextState] || states.idle;
  pushLabel.textContent = setting.label;
  pushStatus.textContent = message || setting.copy;
  pushEnableButton.disabled = setting.disabled;
  pushEnableButton.dataset.pushEnabled = String(setting.enabled);
  pushEnableButton.setAttribute("aria-pressed", String(setting.enabled));
}

function attachPushListeners() {
  const pushPlugin = getPushPlugin();
  if (!pushPlugin || pushListenersAttached) return;
  pushListenersAttached = true;

  pushPlugin.addListener("registration", async (token) => {
    await savePushRegistration(token?.value);
  });

  pushPlugin.addListener("registrationError", (error) => {
    updatePushSetting("error", error?.error || "The iPhone could not register for notifications.");
    showToast("Push notifications could not be enabled.");
  });

  pushPlugin.addListener("pushNotificationReceived", (notification) => {
    showToast(notification?.title || "New VIP notification received.");
  });

  pushPlugin.addListener("pushNotificationActionPerformed", (action) => {
    const targetView = action?.notification?.data?.view;
    if (targetView === "events") {
      activateView("events", "Events");
    }
  });
}

async function refreshPushStatus() {
  if (!pushEnableButton) return;
  if (!isNativeShell() || !getPushPlugin() || !activeMember) {
    updatePushSetting();
    return;
  }

  if (!betaApiReady) {
    updatePushSetting("error", "Connect to the VIP server before enabling notifications.");
    return;
  }

  updatePushSetting("checking");
  try {
    const result = await apiRequest("/api/push/status");
    updatePushSetting(result.enabled ? "enabled" : "idle");
  } catch (error) {
    updatePushSetting("error", error.message || "Notification status could not be checked.");
  }
}

async function savePushRegistration(tokenValue) {
  const cleanToken = String(tokenValue || "").trim();
  if (!cleanToken || !activeMember || !betaApiReady) {
    updatePushSetting("error", "The iPhone did not return a notification token.");
    return;
  }

  try {
    updatePushSetting("registering");
    await apiRequest("/api/push/register", {
      method: "POST",
      body: JSON.stringify({
        token: cleanToken,
        platform: pushPlatform(),
        provider: "capacitor",
        device: pushDeviceLabel(),
      }),
    });
    storePushToken(cleanToken);
    updatePushSetting("enabled");
    showToast("Push notifications enabled.");
  } catch (error) {
    if (error.status === 401) {
      clearStoredMemberSession();
    }
    updatePushSetting("error", error.message || "Push notifications could not be saved.");
    showToast(error.message || "Push notifications could not be enabled.");
  }
}

async function enablePushNotifications() {
  const pushPlugin = getPushPlugin();
  if (!isNativeShell()) {
    updatePushSetting("web");
    showToast("Push notifications are only available in the iPhone app.");
    return;
  }
  if (!pushPlugin) {
    updatePushSetting("missing");
    showToast("Rebuild the iPhone app before testing notifications.");
    return;
  }
  if (!activeMember || !betaApiReady) {
    updatePushSetting();
    showToast("Sign in before enabling notifications.");
    return;
  }

  try {
    attachPushListeners();
    updatePushSetting("checking");
    let permissions = await pushPlugin.checkPermissions();
    if (permissions.receive === "prompt") {
      permissions = await pushPlugin.requestPermissions();
    }

    if (permissions.receive !== "granted") {
      updatePushSetting("denied");
      showToast("Notifications are off for this app.");
      return;
    }

    updatePushSetting("registering");
    await pushPlugin.register();
  } catch (error) {
    updatePushSetting("error", error.message || "Push notifications could not be enabled.");
    showToast(error.message || "Push notifications could not be enabled.");
  }
}

async function disablePushNotifications({ silent = false } = {}) {
  const pushPlugin = getPushPlugin();
  const tokenValue = getStoredPushToken();

  try {
    pushEnableButton?.setAttribute("disabled", "");
    if (pushPlugin?.unregister) {
      await pushPlugin.unregister();
    }
    if (betaApiReady && activeMember) {
      await apiRequest("/api/push/unregister", {
        method: "POST",
        body: JSON.stringify({ token: tokenValue }),
      });
    }
    clearStoredPushToken();
    updatePushSetting("idle");
    if (!silent) showToast("Push notifications turned off.");
  } catch (error) {
    updatePushSetting("error", error.message || "Push notifications could not be turned off.");
    if (!silent) showToast(error.message || "Push notifications could not be turned off.");
  } finally {
    pushEnableButton?.removeAttribute("disabled");
  }
}

function firstNameForGreeting(member = activeMember) {
  const preferredName = String(member?.firstName || member?.cardName || member?.name || "").trim();
  return preferredName.split(/\s+/).filter(Boolean).at(0) || "VIP";
}

function cardScreenTitle(member = activeMember) {
  return `Hi, ${firstNameForGreeting(member)}!`;
}

function activateView(target, title) {
  views.forEach((view) => {
    view.classList.toggle("is-active", view.id === `view-${target}`);
    if (view.id === `view-${target}`) {
      view.scrollTop = 0;
    }
  });

  navItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.viewTarget === target);
  });

  if (viewTitle) {
    viewTitle.textContent = target === "card" ? cardScreenTitle() : title;
  }
}

function updateMemberName(name) {
  const cleanName = name.trim() || "VIP Member";
  document.querySelectorAll(".member-summary h2").forEach((item) => {
    item.textContent = cleanName;
  });

  if (etchedName) {
    etchedName.textContent = cleanName;
  }

  if (avatar) {
    avatar.textContent = cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }
}

function digitsOnly(value) {
  return value.replace(/\D/g, "");
}

function maskDestination(member, identity) {
  if (identity.includes("@")) {
    const [user, domain] = member.email.split("@");
    return `${user.slice(0, 2)}***@${domain}`;
  }

  return `***-***-${member.phone.slice(-4)}`;
}

function findDemoMember(identity, lastName) {
  const cleanIdentity = identity.trim().toLowerCase();
  const cleanPhone = digitsOnly(identity);
  const cleanLastName = lastName.trim().toLowerCase();

  return demoMembers.find((member) => {
    const memberLastName = member.name.split(/\s+/).pop().toLowerCase();
    const identityMatches =
      member.email.toLowerCase() === cleanIdentity ||
      member.phone === cleanPhone ||
      (cleanPhone.length >= 4 && member.phone.endsWith(cleanPhone));
    return identityMatches && memberLastName === cleanLastName;
  });
}

function applyMember(member, options = {}) {
  activeMember = member;
  const displayName = member.cardName || member.name;
  updateMemberName(displayName);

  if (cardNameInput) {
    cardNameInput.value = displayName;
  }

  document.querySelectorAll("[data-request-phone]").forEach((input) => {
    if (!input.value.trim()) {
      input.value = member.phone || "";
    }
  });

  document.querySelectorAll("[data-member-since]").forEach((item) => {
    item.textContent = `Member since ${member.joined}`;
  });

  document.querySelectorAll("[data-member-contact]").forEach((item) => {
    item.textContent = member.email || member.phone || "VIP member";
  });

  appScreen?.classList.add("is-authenticated");
  document.querySelector("[data-auth-screen]")?.setAttribute("hidden", "");
  if (document.querySelector("#view-card")?.classList.contains("is-active") && viewTitle) {
    viewTitle.textContent = cardScreenTitle(member);
  }
  refreshPushStatus();
  if (options.announce !== false) {
    showToast(`Welcome back, ${displayName}.`);
  }
}

function resetMemberAuth() {
  activeMember = null;
  pendingMember = null;
  pendingClaim = null;
  clearStoredMemberSession();

  appScreen?.classList.remove("is-authenticated");
  document.querySelector("[data-auth-screen]")?.removeAttribute("hidden");
  if (claimForm) claimForm.hidden = false;
  if (codeForm) codeForm.hidden = true;
  claimForm?.reset();
  codeForm?.reset();
  conciergeForms.forEach((form) => {
    form.reset();
    const statusMessage = form.querySelector("[data-request-status]");
    if (statusMessage) {
      statusMessage.textContent =
        "Emergency, medical, and urgent legal matters should use direct phone support or emergency services.";
    }
  });

  updatePushSetting();
  activateView("card", "Hi, VIP!");

  if (claimMessage) {
    claimMessage.textContent = "Use the email address connected to your VIP membership.";
  }
  if (codeMessage) {
    codeMessage.textContent = "";
  }
}

function parseEventDate(event) {
  const dateLabel = String(event.dateLabel || "").trim();
  const monthMatch = dateLabel.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})/i);
  if (!monthMatch) return null;

  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = monthNames.indexOf(monthMatch[1].slice(0, 3).toLowerCase());
  const day = Number(monthMatch[2]);
  if (month < 0 || !Number.isFinite(day)) return null;

  const now = new Date();
  const eventDate = new Date(now.getFullYear(), month, day, 12);
  if (eventDate < startOfToday(now)) {
    eventDate.setFullYear(eventDate.getFullYear() + 1);
  }
  return eventDate;
}

function startOfToday(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getOrderedEvents(events) {
  return [...events]
    .map((event, index) => ({
      event,
      index,
      date: parseEventDate(event),
    }))
    .sort((left, right) => {
      if (left.date && right.date) return left.date - right.date;
      if (left.date) return -1;
      if (right.date) return 1;
      return left.index - right.index;
    })
    .map((item) => item.event);
}

function getNextEvent(events) {
  return getOrderedEvents(events)[0];
}

function genericEventMetaValue(value) {
  const label = String(value || "").trim();
  return /eventbrite/i.test(label) ? "" : label;
}

function updateNextInvite(events) {
  if (!nextEventTitle || !nextEventMeta || !Array.isArray(events)) return;
  if (events.length === 0) {
    nextEventTitle.textContent = "No upcoming invites";
    nextEventMeta.textContent = "New event invites will appear here.";
    return;
  }

  const nextEvent = getNextEvent(events);
  if (!nextEvent) return;

  const date = nextEvent.dateLabel || "Date TBD";
  const location = nextEvent.location || nextEvent.city || "Location TBD";
  nextEventTitle.textContent = nextEvent.title || "VIP Event";
  nextEventMeta.textContent = `${date}, ${location} · Tap to view details`;
}

function renderEventsUnavailable() {
  if (eventsList) {
    eventsList.innerHTML = `
      <article class="event-card">
        <div class="event-copy">
          <p class="eyebrow">Events</p>
          <h2>Invites temporarily unavailable</h2>
          <p>Event listings could not be loaded. Please check again in a few minutes.</p>
        </div>
      </article>
    `;
  }

  if (nextEventTitle && nextEventMeta) {
    nextEventTitle.textContent = "Invites temporarily unavailable";
    nextEventMeta.textContent = "Event listings could not be loaded.";
  }
}

function renderEvents(events) {
  if (!eventsList || !Array.isArray(events)) return;
  const orderedEvents = getOrderedEvents(events);
  eventsList.innerHTML = "";

  if (orderedEvents.length === 0) {
    const emptyState = document.createElement("article");
    emptyState.className = "event-card";
    emptyState.innerHTML = `
      <div class="event-copy">
        <p class="eyebrow">Events</p>
        <h2>No upcoming invites</h2>
        <p>New event invites will appear here.</p>
      </div>
    `;
    eventsList.append(emptyState);
    updateNextInvite([]);
    return;
  }

  orderedEvents.forEach((event) => {
    const article = document.createElement("article");
    article.className = "event-card";

    const copy = document.createElement("div");
    copy.className = "event-copy";

    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = event.city || event.location || "VIP Event";

    const title = document.createElement("h2");
    title.textContent = event.title || "VIP Event";

    const description = document.createElement("p");
    description.textContent = event.copy || "VIP member event.";

    const meta = document.createElement("div");
    meta.className = "event-meta";
    [event.dateLabel, event.timeLabel].map(genericEventMetaValue).filter(Boolean).forEach((item) => {
      const span = document.createElement("span");
      span.textContent = item;
      meta.append(span);
    });
    if (!meta.children.length) {
      const span = document.createElement("span");
      span.textContent = "Details TBD";
      meta.append(span);
    }

    const actions = document.createElement("div");
    actions.className = "event-actions";
    const eventUrl = normalizeExternalUrl(event.eventbriteUrl || event.eventUrl);
    if (eventUrl) {
      const link = document.createElement("a");
      link.className = "event-link";
      link.href = eventUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "View event";
      link.addEventListener("click", (clickEvent) => openExternalUrl(clickEvent, eventUrl));
      actions.append(link);
    } else {
      const button = document.createElement("button");
      button.className = "event-link";
      button.type = "button";
      button.disabled = true;
      button.textContent = "Event link coming soon";
      actions.append(button);
    }

    copy.append(eyebrow, title, description, meta, actions);
    article.append(copy);
    eventsList.append(article);
  });

  updateNextInvite(orderedEvents);
}

function renderPerksUnavailable() {
  if (!perksList) return;
  perksList.innerHTML = `
    <article class="perk-card">
      <div class="perk-icon">
        <i data-lucide="sparkles" aria-hidden="true"></i>
        <span class="fallback-icon" aria-hidden="true">V</span>
      </div>
      <div>
        <h2>Perks temporarily unavailable</h2>
        <p>VIP perks could not be loaded. Please check again in a few minutes.</p>
        <small>VIP access is still active</small>
      </div>
    </article>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function renderPerks(perks) {
  if (!perksList || !Array.isArray(perks)) return;
  perksList.innerHTML = "";

  if (perks.length === 0) {
    const emptyState = document.createElement("article");
    emptyState.className = "perk-card";
    emptyState.innerHTML = `
      <div class="perk-icon">
        <i data-lucide="sparkles" aria-hidden="true"></i>
        <span class="fallback-icon" aria-hidden="true">V</span>
      </div>
      <div>
        <h2>No perks published</h2>
        <p>New VIP perks will appear here.</p>
        <small>Check back soon</small>
      </div>
    `;
    perksList.append(emptyState);
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  perks.forEach((perk) => {
    const article = document.createElement("article");
    article.className = `perk-card accent-${perk.accent || "red"}`;

    const icon = document.createElement("div");
    icon.className = "perk-icon";
    const iconElement = document.createElement("i");
    iconElement.setAttribute("data-lucide", perk.icon || "star");
    iconElement.setAttribute("aria-hidden", "true");
    const fallbackIcon = document.createElement("span");
    fallbackIcon.className = "fallback-icon";
    fallbackIcon.setAttribute("aria-hidden", "true");
    fallbackIcon.textContent = String(perk.title || "V").trim().at(0) || "V";
    icon.append(iconElement, fallbackIcon);

    const copy = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = perk.title || "VIP Perk";
    const description = document.createElement("p");
    description.textContent = perk.description || "VIP member perk.";
    const note = document.createElement("small");
    note.textContent = perk.note || "Available now";
    copy.append(title, description, note);

    const label = perk.buttonLabel || "View";
    if (perk.actionUrl) {
      const link = document.createElement("a");
      link.href = perk.actionUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = label;
      article.append(icon, copy, link);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        showToast(perk.actionMessage || `${perk.title || "VIP perk"} selected.`);
      });
      article.append(icon, copy, button);
    }

    perksList.append(article);
  });

  if (window.lucide) window.lucide.createIcons();
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    activateView(item.dataset.viewTarget, item.dataset.title);
  });
});

document.querySelectorAll("[data-toast]").forEach((button) => {
  button.addEventListener("click", () => {
    showToast(button.dataset.toast);
  });
});

document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
  button.addEventListener("click", () => {
    activateView(button.dataset.viewShortcut, button.dataset.title);
    if (button.hasAttribute("data-focus-help-form")) {
      window.setTimeout(() => {
        document.querySelector("[data-concierge-form] select")?.focus();
      }, 0);
    }
  });
});

themeToggles.forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyThemePreference(nextTheme, { persist: true, notify: true });
  });
});

themeControls.forEach((control) => {
  control.addEventListener("click", () => {
    applyThemePreference(control.dataset.themeChoice, { persist: true, notify: true });
  });
});

if (themeMedia) {
  const syncSystemTheme = () => {
    if (getStoredThemePreference() === "system") {
      applyThemePreference("system");
    }
  };

  if (typeof themeMedia.addEventListener === "function") {
    themeMedia.addEventListener("change", syncSystemTheme);
  } else if (typeof themeMedia.addListener === "function") {
    themeMedia.addListener(syncSystemTheme);
  }
}

document.querySelectorAll("[data-sheet-open]").forEach((button) => {
  button.addEventListener("click", () => {
    const sheet = document.getElementById(button.dataset.sheetOpen);
    if (!sheet) return;
    sheet.hidden = false;
  });
});

document.querySelectorAll("[data-sheet-close]").forEach((button) => {
  button.addEventListener("click", () => {
    const sheet = button.closest(".sheet");
    if (!sheet) return;
    sheet.hidden = true;
  });
});

document.querySelectorAll(".sheet").forEach((sheet) => {
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) {
      sheet.hidden = true;
    }
  });
});

claimForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const identity = String(data.get("identity") || "");
  const lastName = String(data.get("lastName") || "");

  if (betaApiReady) {
    try {
      const result = await apiRequest("/api/claim/start", {
        method: "POST",
        body: JSON.stringify({ identity, lastName }),
      });
      const emailStatus = result.email?.status;
      const canEnterCode = Boolean(result.devCode || emailStatus === "sent");

      if (!canEnterCode) {
        pendingClaim = null;
        pendingMember = null;
        if (claimMessage) {
          claimMessage.textContent =
            "We found your VIP record, but the verification email could not be sent. Please email vip@justcallmoe.com for help.";
        }
        return;
      }

      pendingClaim = result.claimToken;
      pendingMember = null;
      form.hidden = true;
      if (codeForm) {
        codeForm.hidden = false;
        codeForm.querySelector("input")?.focus();
      }
      if (codeMessage) {
        codeMessage.textContent = `Code sent to ${result.destination}.${result.devCode ? ` Test code: ${result.devCode}.` : ""}`;
      }
      return;
    } catch (error) {
      pendingClaim = null;
      pendingMember = null;
      if (claimMessage) {
        claimMessage.textContent =
          error.status >= 500
            ? "Member records are temporarily unavailable. Please try again in a few minutes or email vip@justcallmoe.com."
            : error.message || "If this matches a VIP record, we will send a code.";
      }
      return;
    }
  }

  if (!betaApiReady) {
    pendingMember = null;
    if (claimMessage) {
      claimMessage.textContent =
        "The VIP portal is temporarily unavailable. Please try again in a few minutes or email vip@justcallmoe.com.";
    }
    return;
  }

  const member = findDemoMember(identity, lastName);

  if (!member) {
    pendingMember = null;
    if (claimMessage) {
      claimMessage.textContent = "If this matches a VIP record, we will send a verification code.";
    }
    return;
  }

  pendingMember = member;
  pendingClaim = null;
  form.hidden = true;
  if (codeForm) {
    codeForm.hidden = false;
    codeForm.querySelector("input")?.focus();
  }
  if (codeMessage) {
    codeMessage.textContent = `Code sent to ${maskDestination(member, identity)}. Test code: ${demoCode}.`;
  }
});

codeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const code = String(new FormData(form).get("code") || "").trim();

  if (pendingClaim) {
    try {
      const result = await apiRequest("/api/claim/verify", {
        method: "POST",
        body: JSON.stringify({ claimToken: pendingClaim, code }),
      });
      pendingClaim = null;
      storeMemberSession(result.sessionToken);
      applyMember(result.member);
      return;
    } catch (error) {
      if (codeMessage) {
        codeMessage.textContent = error.message || "That code did not match.";
      }
      return;
    }
  }

  if (!pendingMember || code !== demoCode) {
    if (codeMessage) {
      codeMessage.textContent = "That code did not match.";
    }
    return;
  }

  applyMember(pendingMember);
});

document.querySelector("[data-change-identity]")?.addEventListener("click", () => {
  pendingMember = null;
  pendingClaim = null;
  if (claimForm) {
    claimForm.hidden = false;
    claimForm.reset();
  }
  if (codeForm) {
    codeForm.hidden = true;
    codeForm.reset();
  }
  if (claimMessage) {
    claimMessage.textContent = "Use the email address connected to your VIP membership.";
  }
});

document.querySelectorAll("[data-toggle-alert]").forEach((button) => {
  button.addEventListener("click", () => {
    const isOn = button.dataset.enabled !== "false";
    button.dataset.enabled = isOn ? "false" : "true";
    button.textContent = isOn ? "Off" : "On";
    showToast(`Merch alerts ${isOn ? "paused" : "enabled"}.`);
  });
});

conciergeForms.forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const textarea = form.querySelector("textarea");
    const phoneInput = form.querySelector("[data-request-phone]");
    const statusMessage = form.querySelector("[data-request-status]");
    const submitButton = form.querySelector("button[type='submit']");
    const type = form.querySelector("select")?.value || "VIP request";
    if (!textarea) return;

    const defaultStatus =
      "Emergency, medical, and urgent legal matters should use direct phone support or emergency services.";
    const setStatus = (message) => {
      if (statusMessage) {
        statusMessage.textContent = message || defaultStatus;
      }
    };

    if (textarea && textarea.value.trim().length === 0) {
      showToast("Add a short message before sending.");
      setStatus("Add a short message before sending.");
      textarea.focus();
      return;
    }

    const message = textarea.value.trim();
    const phone = phoneInput?.value.trim() || "";
    if (!phone) {
      showToast("Add a phone number before sending.");
      setStatus("Add a phone number before sending.");
      phoneInput?.focus();
      return;
    }

    if (betaApiReady && activeMember) {
      try {
        submitButton?.setAttribute("disabled", "");
        setStatus("Sending your request to the VIP desk...");
        const result = await apiRequest("/api/requests", {
          method: "POST",
          body: JSON.stringify({ type, phone, message }),
        });

        if (result.email?.status !== "sent") {
          throw new Error(
            "The VIP desk email could not be sent. Please call 833-MOE-WINS or email vip@justcallmoe.com."
          );
        }
      } catch (error) {
        if (error.status === 401) {
          clearStoredMemberSession();
        }
        const message =
          error.status === 401
            ? "Please sign in again before sending a help request."
            : error.message ||
              "The VIP desk email could not be sent. Please call 833-MOE-WINS or email vip@justcallmoe.com.";
        setStatus(message);
        showToast(message);
        return;
      } finally {
        submitButton?.removeAttribute("disabled");
      }
    } else {
      setStatus("Please sign in to send concierge requests.");
      showToast("Please sign in to send concierge requests.");
      return;
    }

    setStatus("Sent to the VIP desk. The team will follow up shortly.");
    showToast("Request emailed to the VIP desk.");
    form.reset();
  });
});

document.querySelectorAll(".setting-row input").forEach((input) => {
  if (input.matches("[data-name-input]")) return;

  input.addEventListener("change", () => {
    const label = input.closest(".setting-row")?.querySelector("strong")?.textContent || "Preference";
    showToast(`${label} ${input.checked ? "enabled" : "disabled"}.`);
  });
});

pushEnableButton?.addEventListener("click", () => {
  if (pushEnableButton.dataset.pushEnabled === "true") {
    disablePushNotifications();
    return;
  }

  enablePushNotifications();
});

if (cardNameInput) {
  cardNameInput.addEventListener("input", () => {
    updateMemberName(cardNameInput.value);
  });
}

document.querySelectorAll("[data-save-profile]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (cardNameInput) {
      updateMemberName(cardNameInput.value);
    }

    if (betaApiReady && activeMember && cardNameInput) {
      try {
        const result = await apiRequest("/api/profile", {
          method: "POST",
          body: JSON.stringify({ cardName: cardNameInput.value }),
        });
        applyMember(result.member);
      } catch (error) {
        showToast(error.message || "Profile could not be saved.");
        return;
      }
    }

    showToast("Profile saved.");
  });
});

memberLogoutButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    button.setAttribute("disabled", "");

    try {
      await disablePushNotifications({ silent: true });
      if (betaApiReady) {
        await apiRequest("/api/logout", { method: "POST" });
      }
    } catch (error) {
      // Logout should still clear this device even if the server session is already gone.
    } finally {
      resetMemberAuth();
      button.removeAttribute("disabled");
      showToast("Signed out.");
    }
  });
});

async function bootBetaApi() {
  try {
    await apiRequest("/api/health");
    betaApiReady = true;
  } catch (error) {
    betaApiReady = false;
    renderEventsUnavailable();
    renderPerksUnavailable();
    if (claimMessage) {
      claimMessage.textContent =
        "The VIP portal is temporarily unavailable. Please try again in a few minutes or email vip@justcallmoe.com.";
    }
    finishAppLaunch();
    return;
  }

  const eventsPromise = apiRequest("/api/events")
    .then((events) => renderEvents(events.events))
    .catch(() => renderEventsUnavailable());

  const perksPromise = apiRequest("/api/perks")
    .then((perks) => renderPerks(perks.perks))
    .catch(() => renderPerksUnavailable());

  try {
    const session = await apiRequest("/api/me");
    applyMember(session.member, { announce: false });
  } catch (error) {
    if (error.status === 401) {
      clearStoredMemberSession();
    }
    if (claimMessage) {
      claimMessage.textContent = "Use the email address connected to your VIP membership.";
    }
  } finally {
    finishAppLaunch();
  }

  await Promise.all([eventsPromise, perksPromise]);
}

window.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    window.lucide.createIcons();
    document.documentElement.classList.add("icons-ready");
  }
  updatePushSetting();
  bootBetaApi();
});
