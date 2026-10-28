import { mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

export async function startTestServer({ showCodes = true, mailStatus = null, mockClock = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vip-features-"));
  if (mockClock) await writeFile(join(directory, "clock-offset"), "0");
  for (const file of ["server.mjs", "database.mjs", "event-calendar.mjs", "index.html", "styles.css", "app.js", "admin.html", "admin.css", "admin.js", "assets"]) {
    await cp(new URL(`../${file}`, import.meta.url), join(directory, file), { recursive: true });
  }
  const hooks = mailStatus !== null || mockClock ? ["--import", new URL("./server-test-hooks.mjs", import.meta.url).href] : [];
  const child = spawn(process.execPath, [...hooks, "server.mjs"], {
    cwd: directory,
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", NODE_ENV: "test",
      SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
      SENDGRID_API_KEY: mailStatus === null ? "" : "test-key", VIP_FROM_EMAIL: "vip@example.com",
      VIP_TEST_MAIL_STATUS: mailStatus === null ? "" : String(mailStatus), VIP_TEST_MAIL_LOG: join(directory, "mail.jsonl"),
      VIP_TEST_CLOCK_FILE: mockClock ? join(directory, "clock-offset") : "",
      APNS_PRIVATE_KEY: "", APNS_PRIVATE_KEY_PATH: "", APNS_TEAM_ID: "", APNS_KEY_ID: "",
      VIP_ADMIN_PASSWORD: "local-feature-test", VIP_SHOW_CODES: String(showCodes), VIP_DEV_CODE: "246810" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stderr.on("data", (chunk) => { logs += chunk; });
  const close = async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  };
  let origin;
  try {
    origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Test server timed out: ${logs}`)), 10000);
      child.stdout.on("data", (chunk) => {
        logs += chunk;
        const match = logs.match(/running at (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Test server exited: ${logs}`)); });
    });
  } catch (error) {
    await close();
    throw error;
  }
  return { origin, directory, close };
}

export async function signInMember(origin, email = "avery@example.com", lastName = "Mitchell") {
  const start = await fetch(`${origin}/api/claim/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: email, lastName }) }).then((res) => res.json());
  return fetch(`${origin}/api/claim/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claimToken: start.claimToken, code: start.devCode }) }).then((res) => res.json());
}
