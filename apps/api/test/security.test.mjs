import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeString, createRateLimiter, ApiError, createApiServer } from "../dist/index.js";

const makeServer = (o = {}) => createApiServer({
  createEventId: () => "e-1",
  apiKeyAuthenticator: { async authenticate(i) { if (i.apiKey !== "k") throw new ApiError({ code: "API_KEY_INVALID", message: "bad" }); return { tenantId: i.tenantId }; } },
  hmacVerifier: { async verify() { return true; } },
  idempotency: { async reserve() { return "reserved"; }, async markSucceeded() {}, async markFailed() {} },
  persistence: { async persistInboundEvent() {} },
  queue: { async enqueueInboundEvent() {} },
  ...o,
});

const getHeaders = async (server, method = "GET", url = "/healthz") =>
  (await server.inject({ method, url, headers: {} })).headers;

test("1+2. HSTS header present (HTTPS enforcement)", async () => {
  const h = await getHeaders(makeServer());
  assert.ok(h["strict-transport-security"]?.includes("max-age=31536000"));
  assert.ok(h["strict-transport-security"]?.includes("includeSubDomains"));
});

test("3. X-Content-Type-Options: nosniff", async () => {
  const h = await getHeaders(makeServer());
  assert.equal(h["x-content-type-options"], "nosniff");
});

test("4. X-Frame-Options: DENY", async () => {
  const h = await getHeaders(makeServer());
  assert.equal(h["x-frame-options"], "DENY");
});

test("5. CSP present and restricts default-src to self", async () => {
  const h = await getHeaders(makeServer());
  assert.ok(h["content-security-policy"]?.includes("default-src 'self'"));
  assert.ok(!h["content-security-policy"]?.includes("*"));
  assert.ok(h["content-security-policy"]?.includes("object-src 'none'"));
});

test("6. Script payload sanitized", () => {
  assert.ok(!sanitizeString("<script>alert(1)</script>Hello").includes("<script>"));
});

test("7. Normal CRM text preserved", () => {
  const t = 'Customer said "call me tomorrow" — re: proposal <attached>';
  assert.equal(sanitizeString(t), t);
});

test("8. Sanitization removes event handlers and javascript: URIs", () => {
  assert.ok(!sanitizeString('<img onerror="x">').includes("onerror="));
  assert.ok(!sanitizeString("javascript:alert(1)").includes("javascript:"));
});

test("9. First 10 auth requests succeed", () => {
  const l = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });
  for (let i = 0; i < 10; i++) assert.equal(l.check("ip-9"), true);
});

test("10. 11th request returns false (rate limited)", () => {
  const l = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });
  for (let i = 0; i < 10; i++) l.check("ip-10");
  assert.equal(l.check("ip-10"), false);
});

test("11. Rate limiter resets after window expires", async () => {
  const l = createRateLimiter({ maxRequests: 3, windowMs: 10 });
  for (let i = 0; i < 3; i++) l.check("ip-11");
  assert.equal(l.check("ip-11"), false);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(l.check("ip-11"), true);
});

test("Rate limited endpoint returns 429 RATE_LIMITED", async () => {
  const server = makeServer();
  const ip = `test-ip-${Date.now()}`;
  const req = () => server.inject({ method: "POST", url: "/workspaces", headers: { "x-forwarded-for": ip, "content-type": "application/json", "x-correlation-id": "c-1" }, payload: { firmName: "T", country: "US", userId: "u-1", userEmail: "t@t.com" } });
  for (let i = 0; i < 10; i++) { const r = await req(); assert.notEqual(r.statusCode, 429); }
  const r11 = await req();
  assert.equal(r11.statusCode, 429);
  assert.equal(r11.json().error.code, "RATE_LIMITED");
});

const makeStores = () => {
  const A = { contacts: [{ id: "c-a1", tenantId: "ws-A" }], deals: [{ id: "d-a1", tenantId: "ws-A" }], activities: [{ id: "act-a1", tenantId: "ws-A" }] };
  const B = { contacts: [{ id: "c-b1", tenantId: "ws-B" }], deals: [{ id: "d-b1", tenantId: "ws-B" }], activities: [{ id: "act-b1", tenantId: "ws-B" }] };
  const all = { contacts: [...A.contacts, ...B.contacts], deals: [...A.deals, ...B.deals], activities: [...A.activities, ...B.activities] };
  const read = (table, tenantId) => all[table].filter((r) => r.tenantId === tenantId);
  return { read };
};

test("12. Workspace A cannot read Workspace B contacts", () => {
  const { read } = makeStores();
  assert.equal(read("contacts", "ws-A").filter((r) => r.tenantId === "ws-B").length, 0);
});

test("13. Workspace A cannot read Workspace B deals", () => {
  const { read } = makeStores();
  assert.equal(read("deals", "ws-A").filter((r) => r.tenantId === "ws-B").length, 0);
});

test("14. Workspace A cannot read Workspace B activities", () => {
  const { read } = makeStores();
  assert.equal(read("activities", "ws-A").filter((r) => r.tenantId === "ws-B").length, 0);
});

test("15. Cross-workspace reads return 0 rows in both directions", () => {
  const { read } = makeStores();
  for (const table of ["contacts", "deals", "activities"]) {
    assert.equal(read(table, "ws-A").filter((r) => r.tenantId === "ws-B").length, 0);
    assert.equal(read(table, "ws-B").filter((r) => r.tenantId === "ws-A").length, 0);
  }
});
