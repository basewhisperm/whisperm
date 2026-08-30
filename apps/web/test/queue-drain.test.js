import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const drain = read("lib/queue-drain/drain.ts");
const route = read("app/api/internal/queue-drain/route.ts");
const middleware = read("middleware.ts");

test("Vercel Cron reaches the queue-drain handler without a Clerk session", () => {
  assert.match(middleware, /'\/api\/internal\/queue-drain'/u);
  assert.match(middleware, /if \(isPublicRoute\(request\)\) return NextResponse\.next\(\);/u);
  const publicBypassIndex = middleware.indexOf("if (isPublicRoute(request)) return NextResponse.next();");
  const clerkInvocationIndex = middleware.indexOf("return protectedMiddleware(request, event);");
  assert.ok(publicBypassIndex > 0 && clerkInvocationIndex > publicBypassIndex, "public routes must bypass Clerk before it is invoked");
  assert.match(route, /authorization !== `Bearer \$\{secret\}`/u);
});

test("the queue-drain route fails closed with 503 when CRON_SECRET is unconfigured, and 401 on a mismatched secret", () => {
  assert.match(route, /if \(!secret\) \{\s*return NextResponse\.json\(\{ ok: false, error: "CRON_SECRET_NOT_CONFIGURED" \}, \{ status: 503 \}\);/u);
  assert.match(route, /if \(authorization !== `Bearer \$\{secret\}`\) \{\s*return NextResponse\.json\(\{ ok: false, error: "UNAUTHORIZED" \}, \{ status: 401 \}\);/u);
});

test("the drain reuses apps/worker's real production wiring instead of a second implementation", () => {
  assert.match(drain, /import \{[\s\S]*?createProductionWorkerServices[\s\S]*?\} from "@whisperm\/worker";/u);
  assert.match(drain, /claimAndProcessOneDurableQueueJob\(\{ app, queueJobs, tenantId, queueNames \}\)/u);
});

test("the drain enumerates every tenant with due work instead of assuming a single configured tenant", () => {
  assert.match(drain, /async function listTenantIdsWithDueJobs/u);
  assert.match(drain, /distinct: \["tenantId"\],/u);
});

test("the drain respects a wall-clock time budget so one invocation can't run past the calling route's execution limit", () => {
  assert.match(drain, /const deadline = Date\.now\(\) \+ timeBudgetMs;/u);
  assert.match(drain, /stoppedReason: "TIME_BUDGET_EXCEEDED"/u);
  assert.match(drain, /while \(Date\.now\(\) < deadline\)/u);
});

test("the drain caps jobs per tenant per pass so one runaway tenant can't starve every other tenant", () => {
  assert.match(drain, /maxJobsPerTenantPerTick/u);
  assert.match(drain, /for \(let claimed = 0; claimed < maxJobsPerTenantPerTick && Date\.now\(\) < deadline; claimed \+= 1\)/u);
});
