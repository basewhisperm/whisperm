import { createHash, randomBytes } from "node:crypto";

export const generateRawClaimToken = (): string => randomBytes(32).toString("base64url");

export const hashClaimToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");
