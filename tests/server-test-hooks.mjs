import { appendFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

if (process.env.VIP_TEST_CLOCK_FILE) {
  const now = Date.now;
  Date.now = () => now() + Number(readFileSync(process.env.VIP_TEST_CLOCK_FILE, "utf8"));
}

if (process.env.VIP_TEST_MAIL_STATUS) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://api.sendgrid.com/v3/mail/send") return originalFetch(url, options);
    await appendFile(process.env.VIP_TEST_MAIL_LOG, `${JSON.stringify(JSON.parse(options.body))}\n`);
    return new Response(Number(process.env.VIP_TEST_MAIL_STATUS) === 202 ? "" : "Test mail failure", {
      status: Number(process.env.VIP_TEST_MAIL_STATUS),
    });
  };
}
