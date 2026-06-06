"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { IconX, IconUser, IconBriefcase } from "@tabler/icons-react";

type RecordType = "contact" | "deal";

interface NewContactForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  stage: string;
}

interface NewRecordModalProps {
  open: boolean;
  onClose: () => void;
}

const STAGES = ["Prospect", "Qualified", "Proposal", "Engagement", "Renewal"];

function ContactForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<NewContactForm>({
    firstName: "", lastName: "", email: "", phone: "", company: "", stage: "Prospect",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!form.firstName && !form.email) { setError("First name or email is required."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to create contact");
      onClose();
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[["firstName", "First name"], ["lastName", "Last name"]].map(([key, label]) => (
          <div key={key}>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
            <input
              className="h-9 w-full rounded-xl bg-secondary px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-pulse)]"
              style={{ border: "0.5px solid hsl(var(--border))" }}
              value={form[key as keyof NewContactForm]}
              onChange={e => { const k = key as keyof NewContactForm; setForm(prev => ({ ...prev, [k]: e.target.value })); }}
              placeholder={label}
            />
          </div>
        ))}
      </div>
      {[["email", "Email", "email"], ["phone", "Phone", "tel"], ["company", "Company", "text"]].map(([key, label, type]) => (
        <div key={key}>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
          <input
            type={type}
            className="h-9 w-full rounded-xl bg-secondary px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-pulse)]"
            style={{ border: "0.5px solid hsl(var(--border))" }}
            value={form[key as keyof NewContactForm]}
            onChange={e => { const k = key as keyof NewContactForm; setForm(prev => ({ ...prev, [k]: e.target.value })); }}
            placeholder={label}
          />
        </div>
      ))}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Stage</label>
        <select
          className="h-9 w-full rounded-xl bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-pulse)]"
          style={{ border: "0.5px solid hsl(var(--border))" }}
          value={form.stage}
          onChange={e => setForm(prev => ({ ...prev, stage: e.target.value }))}
        >
          {STAGES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-muted">Cancel</button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="rounded-xl px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--color-whisper)" }}
        >
          {saving ? "Saving…" : "Create contact"}
        </button>
      </div>
    </div>
  );
}

function TypePicker({ onPick }: { onPick: (type: RecordType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {([["contact", "Contact", IconUser, "Add a person or company to your CRM"],
        ["deal", "Deal", IconBriefcase, "Track an opportunity in your pipeline"]] as const).map(([type, label, Icon, desc]) => (
        <button
          key={type}
          onClick={() => onPick(type)}
          className="flex flex-col items-start gap-2 rounded-2xl p-4 text-left transition hover:bg-secondary"
          style={{ border: "0.5px solid hsl(var(--border))" }}
        >
          <div className="flex size-8 items-center justify-center rounded-xl" style={{ background: "var(--color-mist)" }}>
            <Icon className="size-4" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

export function NewRecordModal({ open, onClose }: NewRecordModalProps) {
  const pathname = usePathname();
  const defaultType: RecordType | null =
    pathname === "/contacts" ? "contact" :
    pathname === "/deals" ? "deal" : null;

  const [type, setType] = useState<RecordType | null>(defaultType);

  if (!open) return null;

  const title = type === "contact" ? "New Contact" : type === "deal" ? "New Deal" : "New Record";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-background shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted">
            <IconX className="size-4 text-muted-foreground" stroke={1.8} />
          </button>
        </div>
        <div className="p-6">
          {!type && <TypePicker onPick={setType} />}
          {type === "contact" && <ContactForm onClose={onClose} />}
          {type === "deal" && (
            <p className="text-sm text-muted-foreground">Deal creation coming soon — add contacts first, then create deals from the Pipeline view.</p>
          )}
        </div>
      </div>
    </div>
  );
}
