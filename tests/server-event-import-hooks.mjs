import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// Child-process test fixture only. The production server never imports this file.
const host = "events.moevip-demo.com";
const originalLookup = dns.lookup;
dns.lookup = (name, options) => name === host
  ? Promise.resolve([{ address: "93.184.216.34", family: 4 }]) : originalLookup(name, options);
const originalRequest = https.request;
https.request = (url, options, callback) => {
  if (url.hostname !== host) return originalRequest(url, options, callback);
  const req = new EventEmitter();
  req.end = () => queueMicrotask(() => {
    const response = new PassThrough();
    response.statusCode = 200;
    response.headers = { 'content-type': 'text/html' };
    callback(response);
    response.end(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'ComedyEvent', name: 'VIP Comedy Night', description: 'An evening of live comedy for our VIP members.',
      startDate: '2026-11-19T19:00:00-05:00', endDate: '2026-11-19T21:00:00-05:00',
      image: 'https://vip-app-091y.onrender.com/assets/just-call-moe-vip-card.png',
      location: { name: 'The Comedy Club', address: { streetAddress: '123 Main St', addressLocality: 'Orlando', addressRegion: 'FL', postalCode: '32819' } },
    })}</script>`);
  });
  return req;
};
syncBuiltinESMExports();
