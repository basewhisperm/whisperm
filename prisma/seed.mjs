import { PrismaClient } from "@prisma/client";

import { seedPipelines } from "./pipeline-seed.mjs";

const prisma = new PrismaClient();
const result = await seedPipelines(prisma);
await prisma.$disconnect();
console.log(JSON.stringify(result));
