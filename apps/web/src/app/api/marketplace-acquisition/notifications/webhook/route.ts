import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Meta WhatsApp webhook verification
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  const verifyToken = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "whisperm-webhook-verify";

  if (mode === "subscribe" && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// Meta WhatsApp delivery status webhook
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = body as {
    object?: string;
    entry?: Array<{
      changes?: Array<{
        value?: {
          statuses?: Array<{
            id: string;
            status: "sent" | "delivered" | "read" | "failed";
            timestamp: string;
            recipient_id: string;
            errors?: Array<{ message: string }>;
          }>;
        };
      }>;
    }>;
  };

  if (payload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true });
  }

  const statuses = payload.entry
    ?.flatMap((entry) => entry.changes ?? [])
    ?.flatMap((change) => change.value?.statuses ?? []) ?? [];

  for (const statusUpdate of statuses) {
    const { id: externalMessageId, status, timestamp, errors } = statusUpdate;

    const ts = new Date(Number(timestamp) * 1000);
    const errorMessage = errors?.[0]?.message ?? null;

    // Update MarketplaceSellerInvitation by externalMessageId stored in metadata
    await prisma.$executeRaw`
      UPDATE "MarketplaceSellerInvitation"
      SET
        status = CASE
          WHEN ${status} = 'sent' THEN 'SENT'
          WHEN ${status} = 'delivered' THEN 'SENT'
          WHEN ${status} = 'read' THEN 'OPENED'
          WHEN ${status} = 'failed' THEN 'FAILED'
          ELSE status
        END,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{webhookStatus}',
          to_jsonb(${status}::text)
        ),
        "updatedAt" = NOW()
      WHERE metadata->>'invitationId' = ${externalMessageId}
         OR metadata->>'wamid' = ${externalMessageId}
    `;

    // Update NotificationDeliveryLog
    await prisma.notificationDeliveryLog.updateMany({
      where: { externalMessageId },
      data: {
        status: status === "read" ? "OPENED" : status === "failed" ? "FAILED" : "DELIVERED",
        ...(status === "delivered" || status === "read" ? { deliveredAt: ts } : {}),
        ...(status === "failed" ? { failedAt: ts, errorMessage } : {}),
        metadata: { webhookStatus: status, webhookTimestamp: timestamp },
      },
    });
  }

  return NextResponse.json({ ok: true });
}
