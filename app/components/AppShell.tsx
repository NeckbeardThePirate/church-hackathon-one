"use client";

import { UserButton } from "@clerk/react";
import type { ReactNode } from "react";
import { defaultTitle, PROJECT_KIND_LABEL, type Project } from "../lib/projects";

type AppShellProps = {
  children: ReactNode;
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  /** Narrow rail while import / OCR is in progress */
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
  // Top-level pages by recency, each followed by its sub-pages (indented).
  const ids = new Set(projects.map((p) => p.id));
  const byRecent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const sorted: (Project & { depth: number })[] = [];
  const visit = (page: Project, depth: number) => {
    sorted.push({ ...page, depth });
    if (depth < 4) for (const child of byRecent.filter((p) => p.parentId === page.id)) visit(child, depth + 1);
  };
  for (const page of byRecent.filter((p) => !p.parentId || !ids.has(p.parentId))) visit(page, 0);

  return (
    <div className="flex min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <aside
        className={`flex shrink-0 flex-col border-r border-[var(--line)] bg-[var(--sidebar)] py-4 transition-[width,padding] duration-300 ease-out ${
          sidebarCompact ? "w-[56px] px-1.5" : "w-[240px] px-3"
        }`}
        aria-label="Projects"
      >
        <div
          className={`flex pb-3 ${sidebarCompact ? "flex-col items-center gap-2 px-0" : "items-center justify-between gap-2 px-2"}`}
        >
          {!sidebarCompact ? (
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Workspace</p>
              <p className="mt-2 truncate text-sm font-medium text-[var(--ink)]">Projects</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onNewProject}
            title="New project"
            aria-label="New project"
            className={`shrink-0 rounded-md border border-[var(--line)] font-medium text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)] ${
              sidebarCompact ? "flex size-8 items-center justify-center p-0 text-lg leading-none" : "px-2 py-1 text-xs"
            }`}
          >
            {sidebarCompact ? "+" : "New"}
          </button>
        </div>
        <nav
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] ${
            sidebarCompact ? "items-center gap-1.5 px-0" : "gap-0.5 px-1"
          }`}
        >
          {sorted.length === 0 ? (
            !sidebarCompact ? (
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
                  onClick={() => onSelectProject(project.id)}
                  style={sidebarCompact ? undefined : { paddingLeft: `${0.5 + project.depth * 0.9}rem` }}
                  title={sidebarCompact ? label : undefined}
                  aria-label={sidebarCompact ? label : undefined}
                  className={`flex rounded-md text-left text-sm transition-colors ${
                    sidebarCompact
                      ? `size-9 shrink-0 items-center justify-center p-0 ${
                          active
                            ? "bg-[var(--sidebar-active)] ring-1 ring-[color-mix(in_srgb,var(--accent)_25%,var(--line))]"
                            : "hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)]"
                        }`
                      : `w-full items-start gap-2 py-1.5 pr-2 ${
                          active
                            ? "bg-[var(--sidebar-active)] text-[var(--ink)]"
                            : "text-[var(--ink-muted)] hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)] hover:text-[var(--ink)]"
                        }`
                  }`}
                >
                  <span
                    aria-hidden
                    className={`shrink-0 rounded-full ${kindDot(project.kind)} ${
                      sidebarCompact ? "size-2.5" : "mt-1.5 size-2"
                    }`}
                  />
                  {!sidebarCompact ? (
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
            sidebarCompact ? "justify-center px-0" : "px-2"
          }`}
        >
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: sidebarCompact ? "size-8" : "size-9",
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
            className={`text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] ${sidebarCompact ? "sr-only" : ""}`}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto">{children}</div>
    </div>
  );
}
