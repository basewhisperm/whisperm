#!/usr/bin/env node
// ST1-011: sandbox HTTP provider for the E2E acquisition regression suite. Stands in for the
// real SMS gateway (createHttpSmsProviderFromEnv posts { provider, from, to, body } and expects
// a non-2xx response to mean failure -- see packages/provider-adapters/src/sms/http-sms-provider.ts)
// so invitations can be sent/failed deterministically without touching a real provider.
import { createServer } from "node:http";

export const SMS_MOCK_PORT = Number(process.env.E2E_SMS_MOCK_PORT ?? 4310);

const readJson = (request) => new Promise((resolve) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
  });
});

const send = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

export function createSmsMockServer() {
  const messages = [];
  let failNext = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${SMS_MOCK_PORT}`);

    if (request.method === "GET" && url.pathname === "/__control/health") {
      return send(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__control/fail-next") {
      const body = await readJson(request);
      failNext = typeof body.count === "number" && body.count > 0 ? body.count : 1;
      return send(response, 200, { ok: true, failNext });
    }
    if (request.method === "POST" && url.pathname === "/__control/reset") {
      failNext = 0;
      messages.length = 0;
      return send(response, 200, { ok: true });
    }
    if (request.method === "GET" && url.pathname === "/__control/messages") {
      const to = url.searchParams.get("to");
      const filtered = to === null ? messages : messages.filter((message) => message.to === to);
      return send(response, 200, { ok: true, messages: filtered });
    }
    if (request.method === "POST" && url.pathname === "/sms") {
      const body = await readJson(request);
      if (failNext > 0) {
        failNext -= 1;
        return send(response, 502, { ok: false, error: "Simulated SMS provider outage" });
      }
      messages.push({ to: body.to, body: body.body, from: body.from, provider: body.provider, receivedAt: new Date().toISOString() });
      return send(response, 200, { ok: true, id: `mock-sms-${messages.length}` });
    }

    return send(response, 404, { ok: false, error: "Not found" });
  });

  return server;
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const server = createSmsMockServer();
  server.listen(SMS_MOCK_PORT, "127.0.0.1", () => {
    console.log(`[e2e-sms-mock] listening on http://127.0.0.1:${SMS_MOCK_PORT}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
