import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const route = read("app/api/health/route.ts");
const middleware = read("middleware.ts");

test("health route returns the documented JSON shape", () => {
  assert.match(route, /ok, service: "web", database, timestamp/u);
});

test("health route never leaks a caught error's message (which can carry connection strings)", () => {
  assert.doesNotMatch(route, /catch \([a-zA-Z]+\)/u);
  assert.doesNotMatch(route, /error\.message/u);
});

test("health route returns 503 (not 200) when the database check fails", () => {
  assert.match(route, /status: ok \? 200 : 503/u);
});

test("health route is excluded from Clerk auth in middleware.ts (must be reachable unauthenticated)", () => {
  assert.match(middleware, /'\/api\/health'/u);
  assert.match(middleware, /if \(isClerkBypassRoute\(request\)\) return NextResponse\.next\(\);/u);
});
