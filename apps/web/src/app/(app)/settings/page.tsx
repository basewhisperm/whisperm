"use client";

import { useEffect, useState } from "react";
import { IconAlertCircle, IconBell, IconMail, IconCalendarStats, IconUsers, IconCurrencyDollar, IconLayoutKanban, IconPlus, IconTrash, IconCreditCard } from "@tabler/icons-react";

interface BillingStatus {
  plan: "STARTER" | "GROWTH" | "PRO" | null;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | null;
  trialEndsAt: string | null;
}

const UPGRADE_PLANS: { readonly plan: "GROWTH" | "PRO"; readonly label: string; readonly blurb: string }[] = [
  { plan: "GROWTH", label: "Growth", blurb: "Unlimited contacts, up to 5 pipelines, reports & health scores" },
  { plan: "PRO", label: "Pro", blurb: "Everything unlimited, plus API access" },
];

function daysRemaining(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function BillingCard() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/status")
      .then((res) => res.json())
      .then((body: { data?: BillingStatus }) => {
        if (!cancelled) setStatus(body.data ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function upgrade(plan: "GROWTH" | "PRO") {
    setUpgrading(plan);
    setError(null);
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json() as { ok?: boolean; data?: { checkoutUrl: string }; error?: { message?: string } };
      if (!res.ok || !body.ok || !body.data) {
        setError(body.error?.message ?? "Could not start checkout. Please try again.");
        setUpgrading(null);
        return;
      }
      window.location.href = body.data.checkoutUrl;
    } catch {
      setError("Could not start checkout. Please try again.");
      setUpgrading(null);
    }
  }

  return (
    <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <div className="mb-4 flex items-center gap-2" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
        <IconCreditCard className="size-4" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
        <h2 className="text-sm font-semibold text-foreground">Billing</h2>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between rounded-xl px-3 py-2.5 bg-secondary" style={{ border: "0.5px solid hsl(var(--border))" }}>
            <div>
              <p className="text-sm font-medium text-foreground">{status?.plan ?? "No plan"}</p>
              <p className="text-xs text-muted-foreground">
                {status?.status === "TRIALING" && status.trialEndsAt
                  ? `Trial — ${daysRemaining(status.trialEndsAt)} day${daysRemaining(status.trialEndsAt) === 1 ? "" : "s"} remaining`
                  : status?.status ?? "No active subscription"}
              </p>
            </div>
            <span
              className="text-xs font-medium px-2.5 py-0.5 rounded-full"
              style={{ background: "var(--color-mist)", color: "var(--color-whisper)" }}
            >
              {status?.status ?? "NONE"}
            </span>
          </div>

          {error && <p className="mb-3 text-xs" style={{ color: "var(--color-health-amber)" }}>{error}</p>}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {UPGRADE_PLANS.map(({ plan, label, blurb }) => (
              <div key={plan} className="rounded-xl p-3" style={{ border: "0.5px solid hsl(var(--border))" }}>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="mb-2 text-xs text-muted-foreground">{blurb}</p>
                <button
                  onClick={() => upgrade(plan)}
                  disabled={upgrading !== null || status?.plan === plan}
                  className="h-8 w-full rounded-lg text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: "var(--color-whisper)" }}
                >
                  {status?.plan === plan ? "Current plan" : upgrading === plan ? "Redirecting…" : `Upgrade to ${label}`}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface ToggleSetting {
  id: string;
  label: string;
  description: string;
  icon: typeof IconBell;
}

const TOGGLE_SETTINGS: ToggleSetting[] = [
  { id: "followup", label: "Follow-up reminders", description: "Alert when a client has no activity for 7+ days", icon: IconBell },
  { id: "emailsync", label: "Email sync", description: "Auto-log emails to contact timeline", icon: IconMail },
  { id: "digest", label: "Monthly digest", description: "Pipeline summary email on the 1st of each month", icon: IconCalendarStats },
  { id: "team", label: "Team access", description: "Allow multiple staff logins per workspace", icon: IconUsers },
  { id: "multicurrency", label: "Multi-currency display", description: "Show GHS alongside USD in pipeline and contacts", icon: IconCurrencyDollar },
];

const DEFAULT_STAGES = ["Prospect", "Qualified", "Proposal", "Engagement", "Renewal"];

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Member";
}

const INITIAL_MEMBERS: TeamMember[] = [
  { id: "1", name: "Operator", email: "operator@whisperm.io", role: "Admin" },
];

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200"
      style={{ background: enabled ? "var(--color-whisper)" : "hsl(var(--muted))" }}
    >
      <span
        className="inline-block size-4 rounded-full bg-white shadow transition-transform duration-200 mt-0.5"
        style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

export default function SettingsPage() {
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    followup: true,
    emailsync: false,
    digest: true,
    team: false,
    multicurrency: false,
  });

  const [stages, setStages] = useState<string[]>(DEFAULT_STAGES);
  const [newStage, setNewStage] = useState("");
  const [members, setMembers] = useState<TeamMember[]>(INITIAL_MEMBERS);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"Admin" | "Member">("Member");

  function toggleSetting(id: string) {
    setToggles(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function addStage() {
    const trimmed = newStage.trim();
    if (trimmed && !stages.includes(trimmed)) {
      setStages(prev => [...prev, trimmed]);
      setNewStage("");
    }
  }

  function removeStage(stage: string) {
    if (DEFAULT_STAGES.includes(stage)) return;
    setStages(prev => prev.filter(s => s !== stage));
  }

  function inviteMember() {
    if (!inviteEmail.trim()) return;
    const newMember: TeamMember = {
      id: String(Date.now()),
      name: (inviteEmail.split("@")[0] ?? inviteEmail) as string,
      email: inviteEmail.trim(),
      role: inviteRole,
    };
    setMembers(prev => [...prev, newMember]);
    setInviteEmail("");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BillingCard />

      <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-xs" style={{ background: "var(--color-muted)", color: "var(--color-health-amber)" }}>
        <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" stroke={1.8} />
        <span>
          Preview only: changes below are not saved yet and will reset on reload. Workspace
          preferences, pipeline stages, and team invites aren&apos;t wired to the backend yet.
        </span>
      </div>

      <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <h2 className="mb-4 text-sm font-semibold text-foreground" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
          Workspace preferences
        </h2>
        <div className="space-y-1">
          {TOGGLE_SETTINGS.map((setting) => {
            const Icon = setting.icon;
            return (
              <div key={setting.id} className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-muted">
                <div className="flex items-center gap-3">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--color-mist)" }}>
                    <Icon className="size-3.5" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{setting.label}</p>
                    <p className="text-xs text-muted-foreground">{setting.description}</p>
                  </div>
                </div>
                <Toggle enabled={Boolean(toggles[setting.id])} onChange={() => toggleSetting(setting.id)} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <div className="mb-4 flex items-center gap-2" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
          <IconLayoutKanban className="size-4" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
          <h2 className="text-sm font-semibold text-foreground">Pipeline stages</h2>
        </div>
        <div className="space-y-2">
          {stages.map((stage, i) => (
            <div key={stage} className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-secondary" style={{ border: "0.5px solid hsl(var(--border))" }}>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4 text-right">{i + 1}</span>
                <span className="text-sm font-medium text-foreground">{stage}</span>
                {DEFAULT_STAGES.includes(stage) && (
                  <span className="text-[11px] text-muted-foreground">(default)</span>
                )}
              </div>
              {!DEFAULT_STAGES.includes(stage) && (
                <button onClick={() => removeStage(stage)} className="rounded-lg p-1 hover:bg-muted">
                  <IconTrash className="size-3.5 text-muted-foreground" stroke={1.8} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="h-9 flex-1 rounded-xl bg-secondary px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-pulse)]"
            style={{ border: "0.5px solid hsl(var(--border))" }}
            placeholder="New stage name…"
            value={newStage}
            onChange={e => setNewStage(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addStage()}
          />
          <button onClick={addStage} className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-white transition hover:opacity-90" style={{ background: "var(--color-whisper)" }}>
            <IconPlus className="size-3.5" stroke={1.8} /> Add
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <div className="mb-4 flex items-center gap-2" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
          <IconUsers className="size-4" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
          <h2 className="text-sm font-semibold text-foreground">Team members</h2>
        </div>
        <div className="space-y-2 mb-4">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ border: "0.5px solid hsl(var(--border))" }}>
              <div className="flex items-center gap-3">
                <div className="flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: "var(--color-whisper)" }}>
                  {(m.name[0] ?? "?").toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
              </div>
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "var(--color-mist)", color: "var(--color-whisper)" }}>{m.role}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="h-9 flex-1 rounded-xl bg-secondary px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-pulse)]"
            style={{ border: "0.5px solid hsl(var(--border))" }}
            placeholder="Invite by email…"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && inviteMember()}
          />
          <select
            className="h-9 rounded-xl bg-secondary px-2 text-sm text-foreground focus:outline-none"
            style={{ border: "0.5px solid hsl(var(--border))" }}
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value as "Admin" | "Member")}
          >
            <option>Member</option>
            <option>Admin</option>
          </select>
          <button onClick={inviteMember} className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-white transition hover:opacity-90" style={{ background: "var(--color-whisper)" }}>
            <IconPlus className="size-3.5" stroke={1.8} /> Invite
          </button>
        </div>
      </div>
    </div>
  );
}
