"use client";

export type SellerAcquisitionInviteChannel = "WHATSAPP" | "SMS" | "EMAIL";

export const sellerAcquisitionInviteChannels = ["WHATSAPP", "SMS", "EMAIL"] as const satisfies readonly SellerAcquisitionInviteChannel[];

const channelLabels: Record<SellerAcquisitionInviteChannel, string> = {
  WHATSAPP: "WhatsApp first",
  SMS: "SMS fallback",
  EMAIL: "Email optional",
};

interface ChannelSelectorProps {
  readonly value: SellerAcquisitionInviteChannel;
  readonly onChange: (channel: SellerAcquisitionInviteChannel) => void;
  readonly channels?: readonly SellerAcquisitionInviteChannel[];
  readonly label?: string;
}

export function ChannelSelector({
  value,
  onChange,
  channels = sellerAcquisitionInviteChannels,
  label = "Invitation channel",
}: ChannelSelectorProps) {
  return (
    <div aria-label={label} className="mt-4 grid gap-2 sm:grid-cols-3" role="group">
      {channels.map((option) => {
        const selected = option === value;
        return (
          <button
            aria-pressed={selected}
            className={
              selected
                ? "rounded-full bg-whisper px-4 py-2 text-sm font-semibold text-white"
                : "rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-foreground"
            }
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {channelLabels[option]}
          </button>
        );
      })}
    </div>
  );
}
