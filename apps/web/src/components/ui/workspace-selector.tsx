"use client";

import { useState } from "react";
import { IconBuildingCommunity, IconCheck, IconChevronDown } from "@tabler/icons-react";
import { useWorkspace } from "@/lib/workspace-context";

export function WorkspaceSelector() {
  const { workspaces, active, setActive } = useWorkspace();
  const [open, setOpen] = useState(false);

  if (!active) return (
    <div className="rounded-2xl border-hairline border-ivory/15 bg-ivory/10 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <IconBuildingCommunity aria-hidden="true" className="size-4" stroke={1.8} />
        <span className="text-xs text-ivory/70">Loading…</span>
      </div>
    </div>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full rounded-2xl border-hairline border-ivory/15 bg-ivory/10 p-3 text-left transition hover:bg-ivory/15"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium min-w-0">
            <IconBuildingCommunity aria-hidden="true" className="size-4 shrink-0" stroke={1.8} />
            <span className="truncate">{active.name}</span>
          </div>
          <IconChevronDown aria-hidden="true" className={`size-3 shrink-0 text-ivory/50 transition-transform ${open ? "rotate-180" : ""}`} stroke={1.8} />
        </div>
        <p className="mt-1 text-xs text-ivory/70 truncate">{active.slug ?? "workspace"}</p>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-2xl bg-midnight shadow-xl"
            style={{ border: "0.5px solid rgba(255,255,255,0.15)" }}
          >
            {workspaces.map(ws => (
              <button
                key={ws.id}
                onClick={() => { setActive(ws); setOpen(false); }}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition hover:bg-ivory/10"
              >
                <span className={`truncate ${ws.id === active.id ? "font-medium text-ivory" : "text-ivory/70"}`}>
                  {ws.name}
                </span>
                {ws.id === active.id && (
                  <IconCheck aria-hidden="true" className="size-3.5 shrink-0 text-ivory/70" stroke={2} />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
