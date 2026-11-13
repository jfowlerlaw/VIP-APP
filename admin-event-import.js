class EventLinkImporter {
  constructor(form, request, isReady) {
    this.form = form;
    this.request = request;
    this.isReady = isReady;
    this.status = form.querySelector("[data-event-import-status]");
    this.button = form.querySelector("[data-import-event]");
    this.preview = form.querySelector("[data-event-image-preview]");
    this.submit = form.querySelector("button[type='submit']");
    this.imported = new Map();
    this.dirty = new Set();
    this.generation = 0;
    this.saving = false;
    form.elements.eventUrl.addEventListener("input", () => this.schedule());
    form.addEventListener("input", ({ target }) => {
      if (target.name !== "eventUrl") this.dirty.add(target.name);
      if (target.name === "image") this.updatePreview();
    });
    this.button.addEventListener("click", () => this.start());
    this.preview.addEventListener("error", () => { this.preview.hidden = true; });
    this.preview.addEventListener("load", () => { this.preview.hidden = false; });
  }

  setBusy(value) {
    this.busy = value;
    this.submit.disabled = value || this.saving;
    this.button.disabled = value || this.saving;
    this.form.setAttribute("aria-busy", String(value));
  }

  setSaving(value) {
    this.saving = value;
    this.form.elements.eventUrl.readOnly = value;
    this.setBusy(false);
  }

  reset() {
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.imported.clear();
    this.dirty.clear();
    this.status.textContent = "";
    this.setBusy(false);
    this.updatePreview();
  }

  updatePreview() {
    const value = this.form.elements.image.value.trim();
    this.preview.hidden = true;
    if (/^https?:\/\//i.test(value)) {
      if (this.preview.getAttribute("src") !== value) this.preview.src = value;
      else if (this.preview.complete && this.preview.naturalWidth) this.preview.hidden = false;
    } else this.preview.removeAttribute("src");
  }

  schedule() {
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    // A new link must not retain another event's automatically imported fields.
    for (const [name, value] of this.imported) {
      if (!this.dirty.has(name) && this.form.elements[name].value === value) this.form.elements[name].value = "";
    }
    this.imported.clear();
    this.updatePreview();
    this.status.textContent = "";
    this.setBusy(false);
    const value = this.form.elements.eventUrl.value.trim();
    if (!value || !this.form.elements.eventUrl.validity.valid) return;
    if (!/^https?:\/\//i.test(value)) return;
    this.status.textContent = "Reading event link...";
    this.setBusy(true);
    this.timer = setTimeout(() => this.start(), 650);
  }

  async start() {
    if (this.saving) return;
    clearTimeout(this.timer);
    this.controller?.abort();
    const generation = ++this.generation;
    const url = this.form.elements.eventUrl.value.trim();
    if (!url || !this.isReady()) {
      this.setBusy(false);
      this.status.textContent = url ? "Connect to the admin server before importing." : "Paste an event link first.";
      return;
    }
    this.controller = new AbortController();
    const controller = this.controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    this.setBusy(true);
    this.status.textContent = "Reading event link...";
    try {
      const result = await this.request("/api/admin/events/import", {
        method: "POST", body: JSON.stringify({ url }), signal: this.controller.signal,
      });
      if (generation !== this.generation || url !== this.form.elements.eventUrl.value.trim()) return;
      const event = result.event || {};
      const values = {
        eventName: event.title, eventCopy: event.copy, image: event.image,
        eventDate: event.dateLabel, eventLocation: event.location, city: event.city, address: event.address,
      };
      const canFill = (name) => !this.dirty.has(name) && (!this.form.elements[name].value || this.imported.get(name) === this.form.elements[name].value);
      if (event.startsAt && event.endsAt && canFill("startsAt") && canFill("endsAt")) {
        for (const name of ["startsAt", "endsAt"]) {
          const date = new Date(event[name]);
          if (Number.isFinite(+date)) values[name] = new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        }
      }
      let preserved = false;
      for (const [name, value] of Object.entries(values)) {
        if (!value) continue;
        if (canFill(name)) {
          this.form.elements[name].value = value;
          this.imported.set(name, value);
        } else preserved = true;
      }
      this.updatePreview();
      this.status.textContent = `${result.message || "Details imported. Review before publishing."}${preserved ? " Your existing edits were kept." : ""}`;
    } catch (error) {
      if (generation === this.generation) this.status.textContent = error.name === "AbortError"
        ? "The import timed out. Try again or enter the details manually."
        : error.message || "Could not read this link. Enter the details manually.";
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) this.setBusy(false);
    }
  }
}
