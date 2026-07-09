#!/usr/bin/env node
// WhispeRM Bootstrap -- ST1-013L: first-run orchestration for a new clone.
//
// Runs the safe, idempotent parts of getting a workspace ready (install deps, generate the
// Prisma client, validate the environment) and then prints the exact next commands for anything
// that would be unsafe to run unattended (schema migrations, demo seeding) instead of guessing
// at what the operator wants done to their database.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runStep(label, command, args) {
  console.log(`\n> ${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) {
    console.error(`\n${label} failed to start: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`\n${label} exited with code ${result.status}`);
    return false;
  }
  return true;
}

function printNextSteps() {
  console.log(`
WhispeRM Bootstrap -- next steps (not run automatically; these touch a real database)

  1. Point DATABASE_URL at a Postgres database (local, Neon, or Supabase), and copy the app-level
     env files:
       cp apps/web/.env.example apps/web/.env.local   # then fill in DATABASE_URL, Clerk keys
       cp apps/api/.env.example apps/api/.env
       cp apps/worker/.env.example apps/worker/.env

  2. Apply the schema:
       pnpm --filter @whisperm/web exec prisma migrate deploy --schema=../../prisma/schema.prisma

  3. Seed a demo workspace:
       WHISPERM_DEMO_USER_EMAIL="you@example.com" pnpm seed:demo

  4. Start the app:
       pnpm --filter @whisperm/web dev

See README.md for the full first-run walkthrough and troubleshooting.
`);
}

function main() {
  const steps = [
    ["Install dependencies", "pnpm", ["install"]],
    ["Generate Prisma client", "pnpm", ["exec", "prisma", "generate"]],
  ];

  for (const [label, command, args] of steps) {
    if (!runStep(label, command, args)) {
      console.error(`\nBootstrap stopped: "${label}" failed. Fix the error above and re-run \`pnpm bootstrap\` -- it is safe to re-run.`);
      process.exit(1);
    }
  }

  console.log("\n> Validating environment: pnpm run doctor");
  const doctor = spawnSync("node", [path.join(ROOT, "scripts/doctor.mjs")], { cwd: ROOT, stdio: "inherit" });
  const doctorFailed = doctor.status !== 0;

  printNextSteps();

  if (doctorFailed) {
    console.error("Bootstrap finished with unresolved `pnpm run doctor` failures above -- resolve them before running the app.");
    process.exit(1);
  }

  console.log("Bootstrap finished: dependencies installed, Prisma client generated, environment checks passed.");
}

main();
