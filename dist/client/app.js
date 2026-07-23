const viewTitle = document.querySelector("#view-title");
const navItems = document.querySelectorAll("[data-view-target]");
const views = document.querySelectorAll(".view");
const toast = document.querySelector(".toast");
const conciergeForms = document.querySelectorAll("[data-concierge-form]");
const cardNameInput = document.querySelector("[data-name-input]");
const etchedName = document.querySelector(".etched-name");
const avatar = document.querySelector(".avatar");
const appScreen = document.querySelector(".app-screen");
const claimForm = document.querySelector("[data-claim-form]");
const codeForm = document.querySelector("[data-code-form]");
const passwordLoginForm = document.querySelector("[data-password-login-form]");
const passwordSetupForm = document.querySelector("[data-password-setup-form]");
const claimMessage = document.querySelector("[data-claim-message]");
const codeMessage = document.querySelector("[data-code-message]");
const passwordLoginMessage = document.querySelector("[data-password-login-message]");
const passwordMessage = document.querySelector("[data-password-message]");
const passwordTitle = document.querySelector("[data-password-title]");
const passwordCopy = document.querySelector("[data-password-copy]");
const passwordSubmitLabel = document.querySelector("[data-password-submit-label]");
const authModeButtons = document.querySelectorAll("[data-auth-mode]");
const memberLogoutButtons = document.querySelectorAll("[data-member-logout]");
const eventsList = document.querySelector("[data-events-list]");
const nextEventTitle = document.querySelector("[data-next-event-title]");
const nextEventMeta = document.querySelector("[data-next-event-meta]");
const themeToggles = document.querySelectorAll("[data-theme-toggle]");
const themeControls = document.querySelectorAll("[data-theme-choice]");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const conciergeEmail = "vip@justcallmoe.com";
const demoCode = "246810";
const nativeApiBaseUrl = "https://vip-app-091y.onrender.com";
const themeStorageKey = "jcm-vip-theme";
const memberSessionStorageKey = "jcm-vip-session";
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
    viewTitle.textContent = title;
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

function applyMember(member) {
  activeMember = member;
  const displayName = member.cardName || member.name;
  updateMemberName(displayName);
  updatePasswordSetup(member);

  if (cardNameInput) {
    cardNameInput.value = displayName;
  }

  document.querySelectorAll("[data-request-phone]").forEach((input) => {
    if (!input.value.trim()) {
      input.value = member.phone || "";
    }
  });

  document.querySelectorAll("[data-member-id]").forEach((item) => {
    item.textContent = member.memberId;
  });

  document.querySelectorAll("[data-member-since]").forEach((item) => {
    item.textContent = `Member since ${member.joined}`;
  });

  document.querySelectorAll("[data-member-contact]").forEach((item) => {
    item.textContent = member.email || member.phone || "VIP member";
  });

  appScreen?.classList.add("is-authenticated");
  document.querySelector("[data-auth-screen]")?.setAttribute("hidden", "");
  showToast(
    member.hasPassword
      ? `Welcome back, ${displayName}.`
      : "Welcome back. Add a password in Profile to skip codes next time."
  );
}

function resetMemberAuth() {
  activeMember = null;
  pendingMember = null;
  pendingClaim = null;
  clearStoredMemberSession();

  appScreen?.classList.remove("is-authenticated");
  document.querySelector("[data-auth-screen]")?.removeAttribute("hidden");
  claimForm?.reset();
  passwordLoginForm?.reset();
  codeForm?.reset();
  passwordSetupForm?.reset();
  conciergeForms.forEach((form) => {
    form.reset();
    const statusMessage = form.querySelector("[data-request-status]");
    if (statusMessage) {
      statusMessage.textContent =
        "Emergency, medical, and urgent legal matters should use direct phone support or emergency services.";
    }
  });

  updatePasswordSetup(null);
  setAuthMode("code");
  activateView("card", "Your VIP Card");

  if (claimMessage) {
    claimMessage.textContent = "Use the email address connected to your VIP membership.";
  }
  if (codeMessage) {
    codeMessage.textContent = "";
  }
  if (passwordLoginMessage) {
    passwordLoginMessage.textContent = "Use this after you create a password in your VIP profile.";
  }
}

function updatePasswordSetup(member) {
  if (!passwordTitle || !passwordCopy || !passwordSubmitLabel || !passwordMessage) return;

  if (member?.hasPassword) {
    passwordTitle.textContent = "Password set";
    passwordCopy.textContent = "You can sign in with your email and password next time.";
    passwordSubmitLabel.textContent = "Update Password";
    passwordMessage.textContent = "Enter a new password here if you ever want to change it.";
    return;
  }

  passwordTitle.textContent = "Create a password";
  passwordCopy.textContent = "Create a password after verification so next time you can sign in without waiting for a code.";
  passwordSubmitLabel.textContent = "Save Password";
  passwordMessage.textContent = "Use at least 8 characters.";
}

function setAuthMode(mode) {
  const nextMode = mode === "password" ? "password" : "code";
  authModeButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.authMode === nextMode);
  });

  if (claimForm) claimForm.hidden = nextMode !== "code";
  if (passwordLoginForm) passwordLoginForm.hidden = nextMode !== "password";
  if (codeForm) codeForm.hidden = true;

  if (claimMessage) {
    claimMessage.textContent = "Use the email address connected to your VIP membership.";
  }
  if (passwordLoginMessage) {
    passwordLoginMessage.textContent = "Use this after you create a password in your VIP profile.";
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

function updateNextInvite(events) {
  if (!nextEventTitle || !nextEventMeta || !Array.isArray(events)) return;
  if (events.length === 0) {
    nextEventTitle.textContent = "No upcoming invites";
    nextEventMeta.textContent = "New Eventbrite listings will appear here.";
    return;
  }

  const nextEvent = getNextEvent(events);
  if (!nextEvent) return;

  const date = nextEvent.dateLabel || "Date TBD";
  const location = nextEvent.location || nextEvent.city || "Location TBD";
  const source = nextEvent.source || "Eventbrite";
  nextEventTitle.textContent = nextEvent.title || "VIP Event";
  nextEventMeta.textContent = `${date}, ${location} · ${source} registration`;
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
        <p>New Eventbrite listings will appear here.</p>
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
    [event.dateLabel, event.timeLabel, event.source || "Eventbrite"].forEach((item) => {
      const span = document.createElement("span");
      span.textContent = item || "TBD";
      meta.append(span);
    });

    const actions = document.createElement("div");
    actions.className = "event-actions";
    const link = document.createElement("a");
    link.className = "eventbrite-link";
    link.href = event.eventbriteUrl || "#";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open Eventbrite";
    actions.append(link);

    copy.append(eyebrow, title, description, meta, actions);
    article.append(copy);
    eventsList.append(article);
  });

  updateNextInvite(orderedEvents);
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

authModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setAuthMode(button.dataset.authMode);
  });
});

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
        claimMessage.textContent = error.message || "If this matches a VIP record, we will send a code.";
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

passwordLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(data.get("email") || "");
  const password = String(data.get("password") || "");

  try {
      const result = await apiRequest("/api/login/password", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      form.reset();
      storeMemberSession(result.sessionToken);
      applyMember(result.member);
    } catch (error) {
    if (passwordLoginMessage) {
      passwordLoginMessage.textContent = error.message || "Email or password did not match.";
    }
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
  setAuthMode("code");
  if (codeForm) {
    codeForm.hidden = true;
    codeForm.reset();
  }
  if (claimMessage) {
    claimMessage.textContent = "Use the email address connected to your VIP membership.";
  }
});

passwordSetupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const password = String(data.get("password") || "");
  const confirmPassword = String(data.get("confirmPassword") || "");

  if (password.length < 8) {
    if (passwordMessage) passwordMessage.textContent = "Use at least 8 characters.";
    return;
  }

  if (password !== confirmPassword) {
    if (passwordMessage) passwordMessage.textContent = "Those passwords do not match.";
    return;
  }

  if (!activeMember) {
    if (passwordMessage) passwordMessage.textContent = "Please sign in before creating a password.";
    return;
  }

  try {
    const result = await apiRequest("/api/profile/password", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    activeMember = result.member;
    updatePasswordSetup(result.member);
    form.reset();
    showToast("Password saved.");
  } catch (error) {
    if (passwordMessage) {
      passwordMessage.textContent = error.message || "Password could not be saved.";
    }
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

    const events = await apiRequest("/api/events");
    renderEvents(events.events);

    try {
      const session = await apiRequest("/api/me");
      applyMember(session.member);
    } catch (error) {
      if (error.status === 401) {
        clearStoredMemberSession();
      }
      if (claimMessage) {
        claimMessage.textContent = "Use the email address connected to your VIP membership.";
      }
    }
  } catch (error) {
    betaApiReady = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    window.lucide.createIcons();
    document.documentElement.classList.add("icons-ready");
  }
  bootBetaApi();
});
