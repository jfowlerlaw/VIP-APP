const viewTitle = document.querySelector("#view-title");
const navItems = document.querySelectorAll("[data-view-target]");
const views = document.querySelectorAll(".view");
const toast = document.querySelector(".toast");
const requestTracker = document.querySelector(".request-tracker");
const cardNameInput = document.querySelector("[data-name-input]");
const etchedName = document.querySelector(".etched-name");
const avatar = document.querySelector(".avatar");
const appScreen = document.querySelector(".app-screen");
const claimForm = document.querySelector("[data-claim-form]");
const codeForm = document.querySelector("[data-code-form]");
const claimMessage = document.querySelector("[data-claim-message]");
const codeMessage = document.querySelector("[data-code-message]");
const dateStrip = document.querySelector("[data-date-strip]");
const eventsList = document.querySelector("[data-events-list]");
const nextEventTitle = document.querySelector("[data-next-event-title]");
const nextEventMeta = document.querySelector("[data-next-event-meta]");
const conciergeEmail = "vip@justcallmoe.com";
const demoCode = "246810";
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

  if (cardNameInput) {
    cardNameInput.value = displayName;
  }

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
  showToast(`Welcome back, ${displayName}.`);
}

function bindDatePills() {
  document.querySelectorAll(".date-pill").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".date-pill").forEach((pill) => pill.classList.remove("is-selected"));
      button.classList.add("is-selected");
      showToast(`Showing events for ${button.textContent.replace(/\s+/g, " ").trim()}.`);
    });
  });
}

function renderDateStrip(events) {
  if (!dateStrip) return;
  dateStrip.innerHTML = "";

  if (events.length === 0) {
    const button = document.createElement("button");
    button.className = "date-pill is-selected";
    button.type = "button";
    button.innerHTML = "VIP<br><strong>TBD</strong>";
    dateStrip.append(button);
    return;
  }

  events.slice(0, 6).forEach((event, index) => {
    const [month = "VIP", day = ""] = String(event.dateLabel || "VIP Event").split(/\s+/);
    const button = document.createElement("button");
    button.className = `date-pill${index === 0 ? " is-selected" : ""}`;
    button.type = "button";
    button.innerHTML = `${month}<br><strong>${day}</strong>`;
    dateStrip.append(button);
  });

  bindDatePills();
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
    renderDateStrip([]);
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

  renderDateStrip(orderedEvents);
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
            "We found your VIP record, but the verification email could not be sent. Please contact vip@justcallmoe.com.";
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
        codeMessage.textContent = `Code sent to ${result.destination}.${result.devCode ? ` Beta code: ${result.devCode}.` : ""}`;
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

  const member = findDemoMember(identity, lastName);

  if (!member) {
    pendingMember = null;
    if (claimMessage) {
      claimMessage.textContent = "If this matches a VIP record, we will send a code. Static demo tip: try avery@example.com + Mitchell.";
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
    codeMessage.textContent = `Code sent to ${maskDestination(member, identity)}. Static demo code: ${demoCode}.`;
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
      codeMessage.textContent = "That code did not match. Static demo code: 246810.";
    }
    return;
  }

  applyMember(pendingMember);
});

document.querySelector("[data-change-identity]")?.addEventListener("click", () => {
  pendingMember = null;
  pendingClaim = null;
  if (claimForm) claimForm.hidden = false;
  if (codeForm) {
    codeForm.hidden = true;
    codeForm.reset();
  }
  if (claimMessage) {
    claimMessage.textContent = "Static demo: use avery@example.com, jordan@example.com, or 407-555-0188. Code: 246810.";
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

bindDatePills();

document.querySelectorAll(".request-form").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const textarea = form.querySelector("textarea");
    const type = form.querySelector("select")?.value || "VIP request";
    if (!textarea) return;

    if (textarea && textarea.value.trim().length === 0) {
      showToast("Add a short message before sending.");
      textarea.focus();
      return;
    }

    const message = textarea.value.trim();

    if (betaApiReady && activeMember) {
      try {
        await apiRequest("/api/requests", {
          method: "POST",
          body: JSON.stringify({ type, message }),
        });
      } catch (error) {
        showToast(error.message || "Request could not be sent.");
        return;
      }
    } else {
      showToast("Start the beta server and sign in to send concierge requests.");
      return;
    }

    if (requestTracker && textarea) {
      const item = document.createElement("article");
      item.className = "request-item";
      item.innerHTML = `
        <span class="status-chip">Sent</span>
        <div>
          <strong></strong>
          <p></p>
        </div>
      `;
      item.querySelector("strong").textContent = type;
      item.querySelector("p").textContent = message;
      requestTracker.insertBefore(item, requestTracker.children[1]);
    }

    showToast("Request received. The VIP team will follow up shortly.");
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
      if (claimMessage) {
        claimMessage.textContent = "Enter the email connected to your VIP membership. Local beta code appears after a match.";
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
