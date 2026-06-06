"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface Workspace {
  id: string;
  name: string;
  slug?: string | null;
}

interface WorkspaceContextValue {
  workspaces: Workspace[];
  active: Workspace | null;
  setActive: (workspace: Workspace) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  active: null,
  setActive: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActiveState] = useState<Workspace | null>(null);

  useEffect(() => {
    fetch("/api/workspaces")
      .then(r => r.json())
      .then(data => {
        const ws: Workspace[] = data.workspaces ?? [];
        setWorkspaces(ws);
        const stored = typeof window !== "undefined" ? localStorage.getItem("activeWorkspaceId") : null;
        const found = stored ? ws.find(w => w.id === stored) : null;
        setActiveState(found ?? ws[0] ?? null);
      })
      .catch(() => {});
  }, []);

  function setActive(workspace: Workspace) {
    setActiveState(workspace);
    localStorage.setItem("activeWorkspaceId", workspace.id);
  }

  return (
    <WorkspaceContext.Provider value={{ workspaces, active, setActive }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
