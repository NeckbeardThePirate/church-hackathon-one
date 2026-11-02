"use client";

import { UserButton } from "@clerk/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useClerkKey } from "./ClerkAppProvider";
import { defaultTitle, PROJECT_KIND_LABEL, type Project } from "../lib/projects";

type AppShellProps = {
  children: ReactNode;
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  /** Narrow rail while import / OCR is in progress (desktop only; mobile uses the drawer). */
  sidebarCompact?: boolean;
};

function kindDot(kind: Project["kind"]) {
  const colors: Record<Project["kind"], string> = {
    lesson: "bg-[#7c9cbf]",
    study: "bg-[#a893c4]",
    learn: "bg-[#89b09a]",
  };
  return colors[kind];
}

export function AppShell({
  children,
  projects,
  activeProjectId,
  onSelectProject,
  onNewProject,
  sidebarCompact = false,
}: AppShellProps) {
  const { key: clerkKey } = useClerkKey();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const compactDesktop = sidebarCompact;

  const ids = new Set(projects.map((p) => p.id));
  const byRecent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const sorted: (Project & { depth: number })[] = [];
  const visit = (page: Project, depth: number) => {
    sorted.push({ ...page, depth });
    if (depth < 4) for (const child of byRecent.filter((p) => p.parentId === page.id)) visit(child, depth + 1);
  };
  for (const page of byRecent.filter((p) => !p.parentId || !ids.has(p.parentId))) visit(page, 0);

  const selectProject = useCallback(
    (id: string) => {
      onSelectProject(id);
      setMobileNavOpen(false);
    },
    [onSelectProject],
  );

  const openNewProject = useCallback(() => {
    onNewProject();
    setMobileNavOpen(false);
  }, [onNewProject]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const sidebarInnerCompact = compactDesktop;

  return (
    <div className="flex min-h-dvh bg-[var(--canvas)] text-[var(--ink)]">
      <header className="safe-area-top safe-area-x fixed inset-x-0 top-0 z-50 flex h-12 items-center gap-2 border-b border-[var(--line)] bg-[var(--sidebar)] px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--ink)] hover:bg-[var(--sidebar-active)]"
          aria-label="Open projects menu"
          aria-expanded={mobileNavOpen}
        >
          <span className="flex flex-col gap-1" aria-hidden>
            <span className="block h-0.5 w-5 rounded-full bg-current" />
            <span className="block h-0.5 w-5 rounded-full bg-current" />
            <span className="block h-0.5 w-5 rounded-full bg-current" />
          </span>
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">Projects</p>
        <button
          type="button"
          onClick={openNewProject}
          className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-[var(--line)] px-3 text-sm font-medium text-[var(--ink-muted)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)]"
          aria-label="New project"
        >
          New
        </button>
      </header>

      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[55] bg-black/55 md:hidden"
          aria-label="Close projects menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={`safe-area-top safe-area-bottom fixed inset-y-0 left-0 z-[60] flex w-[min(100vw-2.5rem,280px)] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--sidebar)] py-4 transition-transform duration-300 ease-out max-md:pointer-events-none md:static md:z-auto md:w-[240px] md:translate-x-0 md:pointer-events-auto md:px-3 ${
          mobileNavOpen ? "max-md:translate-x-0 max-md:pointer-events-auto px-3" : "-translate-x-full px-3 md:translate-x-0"
        } ${
          compactDesktop
            ? "md:w-[56px] md:px-1.5"
            : ""
        }`}
        aria-label="Projects"
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-2 md:hidden">
          <p className="text-sm font-medium text-[var(--ink)]">Projects</p>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="inline-flex size-11 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
            aria-label="Close projects menu"
          >
            ✕
          </button>
        </div>
        <div
          className={`flex pb-3 ${sidebarInnerCompact ? "hidden flex-col items-center gap-2 px-0 md:flex" : "items-center justify-between gap-2 px-2"}`}
        >
          {!sidebarInnerCompact ? (
            <div className="hidden min-w-0 md:block">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Workspace</p>
              <p className="mt-2 truncate text-sm font-medium text-[var(--ink)]">Projects</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={openNewProject}
            title="New project"
            aria-label="New project"
            className={`hidden shrink-0 rounded-md border border-[var(--line)] font-medium text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)] md:inline-flex ${
              sidebarInnerCompact ? "size-11 items-center justify-center p-0 text-lg leading-none" : "min-h-11 px-3 py-2 text-xs"
            }`}
          >
            {sidebarInnerCompact ? "+" : "New"}
          </button>
        </div>
        <nav
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] ${
            sidebarInnerCompact ? "hidden items-center gap-1.5 px-0 md:flex" : "gap-0.5 px-1"
          }`}
        >
          {sorted.length === 0 ? (
            !sidebarInnerCompact ? (
              <p className="px-2 py-2 text-xs leading-relaxed text-[var(--ink-muted)]">
                No projects yet. Choose Lesson, Study, or Learn to start one.
              </p>
            ) : null
          ) : (
            sorted.map((project) => {
              const active = project.id === activeProjectId;
              const label = `${defaultTitle(project)} (${PROJECT_KIND_LABEL[project.kind]})`;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => selectProject(project.id)}
                  style={sidebarInnerCompact ? undefined : { paddingLeft: `${0.5 + project.depth * 0.9}rem` }}
                  title={sidebarInnerCompact ? label : undefined}
                  aria-label={sidebarInnerCompact ? label : undefined}
                  className={`flex rounded-md text-left text-sm transition-colors ${
                    sidebarInnerCompact
                      ? `hidden size-11 shrink-0 items-center justify-center p-0 md:flex ${
                          active
                            ? "bg-[var(--sidebar-active)] ring-1 ring-[color-mix(in_srgb,var(--accent)_25%,var(--line))]"
                            : "hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)]"
                        }`
                      : `min-h-11 w-full items-start gap-2 py-2 pr-2 ${
                          active
                            ? "bg-[var(--sidebar-active)] text-[var(--ink)]"
                            : "text-[var(--ink-muted)] hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)] hover:text-[var(--ink)]"
                        }`
                  }`}
                >
                  <span
                    aria-hidden
                    className={`shrink-0 rounded-full ${kindDot(project.kind)} ${
                      sidebarInnerCompact ? "size-2.5" : "mt-1.5 size-2"
                    }`}
                  />
                  {!sidebarInnerCompact ? (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{defaultTitle(project)}</span>
                      <span className="block truncate text-xs text-[var(--ink-muted)]">
                        {project.depth ? "Sub-page" : PROJECT_KIND_LABEL[project.kind]}
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </nav>
        <div
          className={`mt-auto flex items-center gap-3 border-t border-[var(--line)] pt-3 ${
            sidebarInnerCompact ? "hidden justify-center px-0 md:flex" : "px-2"
          }`}
        >
          {clerkKey ? (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: sidebarInnerCompact ? "size-9" : "size-10",
                },
              }}
            />
          ) : null}
          <button
            type="button"
            onClick={() => {
              void fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" }).finally(() => {
                const clerk = (window as unknown as { Clerk?: { signOut: (opts?: { redirectUrl?: string }) => Promise<void> } }).Clerk;
                if (clerk?.signOut) {
                  void clerk.signOut({ redirectUrl: "/" });
                  return;
                }
                window.location.assign("/");
              });
            }}
            className={`min-h-11 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] ${sidebarInnerCompact ? "sr-only" : ""}`}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="relative min-w-0 flex-1 overflow-x-hidden pt-12 md:pt-0 [scrollbar-gutter:stable]">
        <div className="h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable]">{children}</div>
      </div>
    </div>
  );
}
