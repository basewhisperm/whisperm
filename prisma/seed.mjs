import { PrismaClient } from "@prisma/client";

import { seedDefaultPipelines } from "./pipeline-seed.mjs";

const prisma = new PrismaClient();
const result = await seedDefaultPipelines(prisma);
await prisma.$disconnect();
console.log(JSON.stringify(result));
