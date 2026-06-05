"use client";

import { useState } from "react";
import {
  IconSearch, IconUpload, IconPhone, IconMail,
  IconCalendar, IconNote, IconX, IconChevronUp, IconChevronDown,
  IconUser,
} from "@tabler/icons-react";

type Stage = "Prospect" | "Qualified" | "Proposal" | "Engagement" | "Renewal";
type SortKey = "name" | "company" | "stage" | "lastTouchAt";
type SortDir = "asc" | "desc";
interface Contact { id: string; name: string; company: string; email: string; phone: string; stage: Stage; lastTouchDays: number; owner: string; }
interface Activity { id: string; type: "call" | "email" | "meeting" | "note"; description: string; date: string; by: string; }

const CONTACTS: Contact[] = [
  { id: "1", name: "Kwame Asante", company: "Asante & Co", email: "kwame@asante.co", phone: "+233 20 123 4567", stage: "Engagement", lastTouchDays: 18, owner: "Operator" },
  { id: "2", name: "Abena Mensah", company: "Mensah Partners", email: "abena@mensahpartners.com", phone: "+233 24 987 6543", stage: "Proposal", lastTouchDays: 12, owner: "Operator" },
  { id: "3", name: "Kofi Boateng", company: "Boateng Advisory", email: "kofi@boatengadvisory.com", phone: "+233 26 555 0001", stage: "Qualified", lastTouchDays: 21, owner: "Operator" },
  { id: "4", name: "Ama Owusu", company: "Owusu Consulting", email: "ama@owusu.consulting", phone: "+233 27 444 2233", stage: "Prospect", lastTouchDays: 9, owner: "Operator" },
  { id: "5", name: "Yaw Darko", company: "Darko & Sons", email: "yaw@darkosons.com", phone: "+233 20 321 9988", stage: "Renewal", lastTouchDays: 3, owner: "Operator" },
  { id: "6", name: "Efua Agyeman", company: "Agyeman Group", email: "efua@agyemangroup.com", phone: "+233 24 111 5678", stage: "Engagement", lastTouchDays: 1, owner: "Operator" },
  { id: "7", name: "Nana Amponsah", company: "Amponsah & Associates", email: "nana@amponsah.com", phone: "+233 26 777 3344", stage: "Qualified", lastTouchDays: 5, owner: "Operator" },
  { id: "8", name: "Akosua Frimpong", company: "Frimpong Tax", email: "akosua@frimpong.tax", phone: "+233 27 888 9900", stage: "Proposal", lastTouchDays: 7, owner: "Operator" },
];

const CONTACT_ACTIVITIES: Record<string, Activity[]> = {
  "1": [
    { id: "a1", type: "call", description: "Discussed Q2 audit scope and timeline", date: "18 days ago", by: "Operator" },
    { id: "a2", type: "email", description: "Sent engagement letter for review", date: "25 days ago", by: "Operator" },
    { id: "a3", type: "meeting", description: "Initial onboarding meeting", date: "2 months ago", by: "Operator" },
  ],
  "2": [
    { id: "b1", type: "email", description: "Sent proposal for tax advisory services", date: "12 days ago", by: "Operator" },
    { id: "b2", type: "call", description: "Discovery call — identified key pain points", date: "3 weeks ago", by: "Operator" },
  ],
};

const STAGE_STYLES: Record<Stage, { bg: string; color: string }> = {
  Prospect:   { bg: "#EEF2FF", color: "#4338CA" },
  Qualified:  { bg: "#EFF6FF", color: "#1D4ED8" },
  Proposal:   { bg: "#FEF3C7", color: "#B45309" },
  Engagement: { bg: "var(--color-mist)", color: "var(--color-whisper)" },
  Renewal:    { bg: "#DCFCE7", color: "#15803D" },
};

function StageBadge({ stage }: { stage: Stage }) {
  const s = STAGE_STYLES[stage];
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide" style={{ background: s.bg, color: s.color }}>{stage}</span>;
}

function lastTouchLabel(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function lastTouchColor(days: number) {
  if (days <= 7) return "var(--color-growth)";
  if (days <= 14) return "#F59E0B";
  return "#EF4444";
}

function getActivityIcon(type: Activity["type"]) {
  switch (type) {
    case "call":    return IconPhone;
    case "email":   return IconMail;
    case "meeting": return IconCalendar;
    case "note":    return IconNote;
  }
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function ContactDrawer({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const activities = CONTACT_ACTIVITIES[contact.id] ?? [];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between p-5" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: "var(--color-whisper)" }}>{initials(contact.name)}</div>
          <div>
            <p className="font-semibold text-foreground">{contact.name}</p>
            <p className="text-xs text-muted-foreground">{contact.company}</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted"><IconX className="size-4 text-muted-foreground" stroke={1.8} /></button>
      </div>
      <div className="space-y-3 p-5" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
        <div className="flex items-center gap-2 text-sm"><IconMail className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} /><a href={`mailto:${contact.email}`} className="text-[var(--color-whisper)] hover:underline">{contact.email}</a></div>
        <div className="flex items-center gap-2 text-sm"><IconPhone className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} /><span className="text-foreground">{contact.phone}</span></div>
        <div className="flex items-center gap-2 text-sm"><IconUser className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} /><span className="text-foreground">{contact.owner}</span></div>
        <div className="flex items-center gap-2"><StageBadge stage={contact.stage} /><span className="text-xs text-muted-foreground">· Last touch {lastTouchLabel(contact.lastTouchDays)}</span></div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Activity Timeline</p>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activities logged yet.</p>
        ) : (
          <div className="space-y-1">
            {activities.map((a) => {
              const Icon = getActivityIcon(a.type);
              return (
                <div key={a.id} className="flex items-start gap-3 rounded-xl p-3 hover:bg-muted">
                  <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--color-mist)" }}><Icon className="size-3" style={{ color: "var(--color-whisper)" }} stroke={1.8} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{a.description}</p>
                    <p className="text-xs text-muted-foreground">{a.date} · {a.by}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<Stage | "All">("All");
  const [sortKey, setSortKey] = useState<SortKey>("lastTouchAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Contact | null>(null);

  const stages: (Stage | "All")[] = ["All", "Prospect", "Qualified", "Proposal", "Engagement", "Renewal"];

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const filtered = CONTACTS
    .filter(c => {
      const q = search.toLowerCase();
      return (stageFilter === "All" || c.stage === stageFilter) &&
        (c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case "name":        av = a.name; bv = b.name; break;
        case "company":     av = a.company; bv = b.company; break;
        case "stage":       av = a.stage; bv = b.stage; break;
        case "lastTouchAt": av = a.lastTouchDays; bv = b.lastTouchDays; break;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <IconChevronUp className="size-3 opacity-20" />;
    return sortDir === "asc" ? <IconChevronUp className="size-3" style={{ color: "var(--color-whisper)" }} /> : <IconChevronDown className="size-3" style={{ color: "var(--color-whisper)" }} />;
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1" style={{ minWidth: 200 }}>
            <IconSearch className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" stroke={1.8} />
            <input
              className="h-9 w-full rounded-xl bg-secondary pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-pulse)]"
              style={{ border: "0.5px solid hsl(var(--border))" }}
              placeholder="Search contacts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground hover:bg-secondary" style={{ border: "0.5px solid hsl(var(--border))" }}>
            <IconUpload className="size-3.5" stroke={1.8} /> Import CSV
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {stages.map(s => (
            <button key={s} onClick={() => setStageFilter(s)} className="rounded-full px-3 py-1 text-xs font-medium transition"
              style={stageFilter === s ? { background: "var(--color-whisper)", color: "#fff" } : { background: "hsl(var(--secondary))", color: "hsl(var(--muted-foreground))", border: "0.5px solid hsl(var(--border))" }}>
              {s}
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-2xl" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {([["name", "Name"], ["company", "Company"], ["stage", "Stage"], ["lastTouchAt", "Last Touch"]] as [SortKey, string][]).map(([key, label]) => (
                  <th key={key} className="cursor-pointer px-4 py-3" onClick={() => toggleSort(key)}>
                    <span className="flex items-center gap-1">{label}<SortIcon col={key} /></span>
                  </th>
                ))}
                <th className="px-4 py-3">Owner</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr key={contact.id} className="cursor-pointer hover:bg-secondary" style={{ borderTop: "0.5px solid hsl(var(--border))" }} onClick={() => setSelected(contact)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: "var(--color-whisper)" }}>{initials(contact.name)}</div>
                      <div>
                        <p className="font-medium text-foreground">{contact.name}</p>
                        <p className="text-xs text-muted-foreground">{contact.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{contact.company}</td>
                  <td className="px-4 py-3"><StageBadge stage={contact.stage} /></td>
                  <td className="px-4 py-3"><span className="font-medium" style={{ color: lastTouchColor(contact.lastTouchDays) }}>{lastTouchLabel(contact.lastTouchDays)}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{contact.owner}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">No contacts match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{filtered.length} of {CONTACTS.length} contacts</p>
      </div>
      {selected && (
        <div className="h-fit w-80 shrink-0 overflow-hidden rounded-2xl bg-background" style={{ border: "2px solid var(--color-whisper)" }}>
          <ContactDrawer contact={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
