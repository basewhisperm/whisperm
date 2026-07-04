import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError, PrismaSellerAcquisitionCampaignRepository } from "../dist/index.js";

const now = "2026-06-11T00:00:00.000Z";

// ST1-007: campaign membership refresh support -- requalification must be able to look up a
// capture's existing memberships and update their contact/deal linkage + status without
// recreating the membership row.
test("listMembersByCapture is tenant-scoped and excludes removed members", async () => {
  const member = { id: "member-1", tenantId: "tenant-a", campaignId: "campaign-1", marketplaceCaptureId: "capture-1", contactId: null, dealId: null, status: "ADDED", assignedAt: now, createdAt: now, updatedAt: now };
  const prisma = {
    sellerAcquisitionCampaignMember: {
      calls: [],
      findMany: async (args) => {
        prisma.sellerAcquisitionCampaignMember.calls.push({ method: "findMany", args });
        return [member];
      },
    },
  };
  const repo = new PrismaSellerAcquisitionCampaignRepository(prisma);

  const members = await repo.listMembersByCapture({ tenantId: "tenant-a" }, "capture-1");

  assert.equal(members.length, 1);
  assert.equal(members[0].id, "member-1");
  const call = prisma.sellerAcquisitionCampaignMember.calls[0];
  assert.equal(call.args.where.tenantId, "tenant-a");
  assert.equal(call.args.where.marketplaceCaptureId, "capture-1");
  assert.equal(call.args.where.removedAt, null);
});

test("updateMember links contact/deal and bumps status without creating a new row", async () => {
  const member = { id: "member-1", tenantId: "tenant-a", campaignId: "campaign-1", marketplaceCaptureId: "capture-1", contactId: null, dealId: null, status: "ADDED", assignedAt: now, createdAt: now, updatedAt: now };
  const prisma = {
    sellerAcquisitionCampaignMember: {
      calls: [],
      updateMany: async (args) => {
        prisma.sellerAcquisitionCampaignMember.calls.push({ method: "updateMany", args });
        assert.equal(args.where.id, "member-1");
        assert.equal(args.where.tenantId, "tenant-a");
        Object.assign(member, args.data);
        return { count: 1 };
      },
      findFirst: async (args) => {
        prisma.sellerAcquisitionCampaignMember.calls.push({ method: "findFirst", args });
        return member;
      },
    },
  };
  const repo = new PrismaSellerAcquisitionCampaignRepository(prisma);

  const updated = await repo.updateMember({ tenantId: "tenant-a" }, "member-1", { contactId: "contact-1", dealId: "deal-1", status: "QUALIFIED" });

  assert.equal(updated.contactId, "contact-1");
  assert.equal(updated.dealId, "deal-1");
  assert.equal(updated.status, "QUALIFIED");
  const updateCall = prisma.sellerAcquisitionCampaignMember.calls.find((c) => c.method === "updateMany");
  assert.deepEqual(updateCall.args.data, { contactId: "contact-1", dealId: "deal-1", status: "QUALIFIED" });
});

test("updateMember rejects a member from another tenant", async () => {
  const prisma = {
    sellerAcquisitionCampaignMember: {
      updateMany: async () => ({ count: 0 }),
    },
  };
  const repo = new PrismaSellerAcquisitionCampaignRepository(prisma);

  await assert.rejects(
    () => repo.updateMember({ tenantId: "tenant-b" }, "member-1", { status: "QUALIFIED" }),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_NOT_FOUND",
  );
});
