"use client";

import { useEffect, useState } from "react";
import {
  IconChevronDown,
  IconChevronUp,
  IconMail,
  IconPhone,
  IconSearch,
  IconUpload,
  IconX,
} from "@tabler/icons-react";

type SortKey = "name" | "company" | "stage" | "lastTouchAt";
type SortDir = "asc" | "desc";

interface Contact {
  id: string;
  tenantId: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  stage?: string | null;
  lastTouchAt?: string | null;
  source?: string | null;
  createdAt: string;
  updatedAt: string;
}

const STAGE_STYLES: Record<string, { bg: string; color: string }> = {
  Prospect: { bg: "var(--color-mist)", color: "var(--color-whisper)" },
  Qualified: { bg: "var(--color-secondary)", color: "var(--color-pulse)" },
  Proposal: { bg: "var(--color-muted)", color: "var(--color-health-amber)" },
  Engagement: { bg: "var(--color-mist)", color: "var(--color-whisper)" },
  Renewal: { bg: "var(--color-secondary)", color: "var(--color-growth)" },
};

function StageBadge({ stage }: { stage?: string | null | undefined }) {
  if (!stage) return null;

  const style = STAGE_STYLES[stage] ?? {
    bg: "var(--color-muted)",
    color: "var(--color-muted-foreground)",
  };

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
      style={{ background: style.bg, color: style.color }}
    >
      {stage}
    </span>
  );
}

function getContactName(contact: Contact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return name || contact.email || contact.company || "Unknown";
}

function getInitials(contact: Contact): string {
  const name = getContactName(contact);

  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function lastTouchLabel(lastTouchAt?: string | null): string {
  if (!lastTouchAt) return "Never";

  const days = Math.floor((Date.now() - new Date(lastTouchAt).getTime()) / 86400000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function lastTouchColor(lastTouchAt?: string | null): string {
  if (!lastTouchAt) return "var(--color-health-red)";

  const days = Math.floor((Date.now() - new Date(lastTouchAt).getTime()) / 86400000);

  if (days <= 7) return "var(--color-growth)";
  if (days <= 14) return "var(--color-health-amber)";
  return "var(--color-health-red)";
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("All");
  const [sortKey, setSortKey] = useState<SortKey>("lastTouchAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Contact | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/contacts")
      .then((response) => response.json())
      .then((data: { contacts?: Contact[] }) => {
        if (!cancelled) {
          setContacts(data.contacts ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stages = ["All", "Prospect", "Qualified", "Proposal", "Engagement", "Renewal"];

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDir("asc");
  }

  const filtered = contacts
    .filter((contact) => {
      const term = search.trim().toLowerCase();
      const matchesSearch =
        term.length === 0 ||
        getContactName(contact).toLowerCase().includes(term) ||
        (contact.company ?? "").toLowerCase().includes(term) ||
        (contact.email ?? "").toLowerCase().includes(term) ||
        (contact.phone ?? "").toLowerCase().includes(term);

      const matchesStage = stageFilter === "All" || contact.stage === stageFilter;

      return matchesSearch && matchesStage;
    })
    .sort((a, b) => {
      let av: string | number;
      let bv: string | number;

      switch (sortKey) {
        case "name":
          av = getContactName(a);
          bv = getContactName(b);
          break;
        case "company":
          av = a.company ?? "";
          bv = b.company ?? "";
          break;
        case "stage":
          av = a.stage ?? "";
          bv = b.stage ?? "";
          break;
        case "lastTouchAt":
          av = a.lastTouchAt ? new Date(a.lastTouchAt).getTime() : 0;
          bv = b.lastTouchAt ? new Date(b.lastTouchAt).getTime() : 0;
          break;
      }

      const comparison = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? comparison : -comparison;
    });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) {
      return <IconChevronUp className="size-3 opacity-20" />;
    }

    return sortDir === "asc" ? (
      <IconChevronUp className="size-3" style={{ color: "var(--color-whisper)" }} />
    ) : (
      <IconChevronDown className="size-3" style={{ color: "var(--color-whisper)" }} />
    );
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1" style={{ minWidth: 200 }}>
            <IconSearch className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" stroke={1.8} />
            <input
              className="h-9 w-full rounded-xl bg-secondary pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-pulse)]"
              style={{ border: "0.5px solid var(--color-border)" }}
              placeholder="Search contacts…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground hover:bg-secondary"
            style={{ border: "0.5px solid var(--color-border)" }}
          >
            <IconUpload className="size-3.5" stroke={1.8} />
            Import CSV
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {stages.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => setStageFilter(stage)}
              className="rounded-full px-3 py-1 text-xs font-medium transition"
              style={
                stageFilter === stage
                  ? { background: "var(--color-whisper)", color: "var(--color-primary-foreground)" }
                  : {
                      background: "var(--color-secondary)",
                      color: "var(--color-muted-foreground)",
                      border: "0.5px solid var(--color-border)",
                    }
              }
            >
              {stage}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl" style={{ border: "0.5px solid var(--color-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {(
                  [
                    ["name", "Name"],
                    ["company", "Company"],
                    ["stage", "Stage"],
                    ["lastTouchAt", "Last Touch"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th key={key} className="cursor-pointer px-4 py-3" onClick={() => toggleSort(key)}>
                    <span className="flex items-center gap-1">
                      {label}
                      <SortIcon col={key} />
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3">Source</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Loading contacts…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {contacts.length === 0 ? "No contacts yet — import a CSV or add your first client." : "No contacts match your search."}
                  </td>
                </tr>
              ) : (
                filtered.map((contact) => (
                  <tr
                    key={contact.id}
                    className="cursor-pointer hover:bg-secondary"
                    style={{ borderTop: "0.5px solid var(--color-border)" }}
                    onClick={() => setSelected(contact)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground"
                          style={{ background: "var(--color-whisper)" }}
                        >
                          {getInitials(contact)}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{getContactName(contact)}</p>
                          <p className="text-xs text-muted-foreground">{contact.email ?? ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">{contact.company ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StageBadge stage={contact.stage} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium" style={{ color: lastTouchColor(contact.lastTouchAt) }}>
                        {lastTouchLabel(contact.lastTouchAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{contact.source ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          {filtered.length} of {contacts.length} contacts
        </p>
      </div>

      {selected && (
        <div className="h-fit w-80 shrink-0 overflow-hidden rounded-2xl bg-background" style={{ border: "2px solid var(--color-whisper)" }}>
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between p-5" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex size-10 items-center justify-center rounded-full text-sm font-semibold text-primary-foreground"
                  style={{ background: "var(--color-whisper)" }}
                >
                  {getInitials(selected)}
                </div>
                <div>
                  <p className="font-semibold text-foreground">{getContactName(selected)}</p>
                  <p className="text-xs text-muted-foreground">{selected.company ?? ""}</p>
                </div>
              </div>

              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1 hover:bg-muted">
                <IconX className="size-4 text-muted-foreground" stroke={1.8} />
              </button>
            </div>

            <div className="space-y-3 p-5" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
              {selected.email && (
                <div className="flex items-center gap-2 text-sm">
                  <IconMail className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
                  <a href={`mailto:${selected.email}`} className="text-[var(--color-whisper)] hover:underline">
                    {selected.email}
                  </a>
                </div>
              )}

              {selected.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <IconPhone className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
                  <span className="text-foreground">{selected.phone}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <StageBadge stage={selected.stage} />
                <span className="text-xs text-muted-foreground">· Last touch {lastTouchLabel(selected.lastTouchAt)}</span>
              </div>
            </div>

            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Details</p>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <p>Source: {selected.source ?? "—"}</p>
                <p>Added: {new Date(selected.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}