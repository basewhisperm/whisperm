import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const webPackage = JSON.parse(readFileSync("package.json", "utf8"));
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));

test("Vercel build does not acquire database migration locks", () => {
  assert.equal(vercelConfig.buildCommand, "pnpm --filter @whisperm/types build && pnpm build");
  assert.doesNotMatch(webPackage.scripts.build, /prisma migrate deploy/u);
  assert.match(webPackage.scripts.build, /next build/u);
  assert.equal(webPackage.scripts["migrate:deploy"], "prisma migrate deploy --schema=../../prisma/schema.prisma");
});
