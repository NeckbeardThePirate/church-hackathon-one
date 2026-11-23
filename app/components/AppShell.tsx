"use client";

import { UserButton } from "@clerk/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useClerkKey } from "./ClerkAppProvider";
import { defaultTitle, isLegacyProject, type Project } from "../lib/projects";
import { statsFigures, type DailyGoalStatus, type LessonMastery } from "../lib/learn/learner-stats";
import { LearnerStatsPanel } from "./LearnerStatsPanel";

type AppShellProps = {
  children: ReactNode;
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  /** Narrow rail while import / OCR is in progress (desktop only; mobile uses the drawer). */
  sidebarCompact?: boolean;
  stats?: { xp: number; streak: number } | null;
  mastery?: LessonMastery[];
  goal?: DailyGoalStatus | null;
  nextLabel?: string | null;
  onNext?: () => void;
  onShowProgress?: () => void;
  onRequestDelete?: (id: string) => void;
};

export function AppShell({
  children,
  projects,
  activeProjectId,
  onSelectProject,
  onNewProject,
  sidebarCompact = false,
  stats = null,
  mastery = [],
  goal = null,
  nextLabel = null,
  onNext,
  onShowProgress,
  onRequestDelete,
}: AppShellProps) {
  const { key: clerkKey } = useClerkKey();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const figures = statsFigures(stats);
  const compactDesktop = sidebarCompact;

  const byRecent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const paths = byRecent.filter((p) => !isLegacyProject(p));
  const archived = byRecent.filter((p) => isLegacyProject(p));

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

  const renderItem = (project: Project) => {
    const active = project.id === activeProjectId;
    const archivedItem = isLegacyProject(project);
    const label = `${defaultTitle(project)}${archivedItem ? " (archived)" : ""}`;
    const rowClass = sidebarInnerCompact
      ? `hidden size-11 shrink-0 items-center justify-center p-0 md:flex ${
          active
            ? "bg-[var(--sidebar-active)] ring-1 ring-[color-mix(in_srgb,var(--accent)_25%,var(--line))]"
            : "hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)]"
        }`
      : `min-h-11 w-full items-center gap-1 px-2 py-2 ${
          active
            ? "bg-[var(--sidebar-active)] text-[var(--ink)]"
            : "text-[var(--ink-muted)] hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)] hover:text-[var(--ink)]"
        }`;
    return (
      <div key={project.id} className={`flex rounded-md text-left text-sm transition-colors ${rowClass}`}>
        <button
          type="button"
          onClick={() => selectProject(project.id)}
          title={sidebarInnerCompact ? label : undefined}
          aria-label={sidebarInnerCompact ? label : undefined}
          aria-current={active ? "page" : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md text-left ${sidebarInnerCompact ? "size-11 justify-center" : "min-h-11 py-0.5"}`}
        >
          <span
            aria-hidden
            className={`shrink-0 rounded-full ${archivedItem ? "bg-[var(--line)]" : project.learnFailed && !project.importComplete ? "bg-[#c0533f]" : "bg-[#89b09a]"} ${sidebarInnerCompact ? "size-2.5" : "size-2"}`}
          />
          {!sidebarInnerCompact ? (
            <span className="min-w-0 flex-1 truncate">
              {defaultTitle(project)}
              {project.learnFailed && !project.importComplete ? (
                <span className="ml-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#c0533f]">Failed</span>
              ) : null}
            </span>
          ) : null}
        </button>
        {!sidebarInnerCompact && !archivedItem && onRequestDelete ? (
          <button
            type="button"
            aria-label={`Remove ${defaultTitle(project)}`}
            onClick={() => onRequestDelete(project.id)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-base leading-none text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  };


  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <header className="safe-area-top fixed inset-x-0 top-0 z-50 flex h-12 items-center gap-2 border-b border-[var(--line)] bg-[var(--sidebar)] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--ink)] hover:bg-[var(--sidebar-active)]"
          aria-label="Open menu"
          aria-expanded={mobileNavOpen}
        >
          <span className="flex flex-col gap-1" aria-hidden>
            <span className="block h-0.5 w-5 rounded-full bg-current" />
            <span className="block h-0.5 w-5 rounded-full bg-current" />
            <span className="block h-0.5 w-5 rounded-full bg-current" />
          </span>
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">StudyBuddy</p>
        <p className="shrink-0 text-[11px] tabular-nums text-[var(--ink-muted)]" aria-label="Learner stats" aria-busy={figures.busy}>
          {figures.busy ? "XP … · Streak …" : `${figures.xp} XP · ${figures.streak}d`}
        </p>
        <button
          type="button"
          onClick={openNewProject}
          className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-[var(--line)] px-3 text-sm font-medium text-[var(--ink-muted)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)]"
          aria-label="New path"
        >
          New path
        </button>
      </header>

      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[55] bg-black/55 md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={`safe-area-top safe-area-bottom fixed inset-y-0 left-0 z-[60] flex w-[min(100vw-2.5rem,280px)] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--sidebar)] py-4 transition-transform duration-300 ease-out md:static md:z-auto md:min-h-0 md:w-[240px] md:overflow-hidden md:translate-x-0 md:pointer-events-auto md:px-3 ${
          mobileNavOpen ? "max-md:translate-x-0 max-md:pointer-events-auto px-3" : "max-md:pointer-events-none -translate-x-full px-3 md:translate-x-0"
        } ${
          compactDesktop
            ? "md:w-[56px] md:px-1.5"
            : ""
        }`}
        aria-label="Learn paths"
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-2 md:hidden">
          <p className="text-sm font-medium text-[var(--ink)]">StudyBuddy</p>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="inline-flex size-11 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <div
          className={`flex pb-3 ${sidebarInnerCompact ? "hidden flex-col items-center gap-2 px-0 md:flex" : "items-center justify-between gap-2 px-2"}`}
        >
          {!sidebarInnerCompact ? (
            <div className="hidden min-w-0 md:block">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">StudyBuddy</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">Learn paths</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={openNewProject}
            title="New path"
            aria-label="New path"
            className={`hidden shrink-0 rounded-md border border-[var(--line)] font-medium text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)] md:inline-flex ${
              sidebarInnerCompact ? "size-11 items-center justify-center p-0 text-lg leading-none" : "min-h-11 px-3 py-2 text-xs"
            }`}
          >
            {sidebarInnerCompact ? "+" : "New path"}
          </button>
        </div>
        {!sidebarInnerCompact ? (
          <div className="px-2">
            <LearnerStatsPanel
              pending={!stats}
              xp={stats?.xp ?? 0}
              streak={stats?.streak ?? 0}
              lessons={mastery}
              goal={stats ? goal : null}
              nextLabel={nextLabel}
              onNext={
                onNext
                  ? () => {
                      onNext();
                      setMobileNavOpen(false);
                    }
                  : undefined
              }
            />
            {onShowProgress ? (
              <button
                type="button"
                onClick={() => {
                  onShowProgress();
                  setMobileNavOpen(false);
                }}
                className="mt-1 flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm text-[var(--ink-muted)] hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)] hover:text-[var(--ink)]"
              >
                Progress
              </button>
            ) : null}
          </div>
        ) : null}
        <nav
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] ${
            sidebarInnerCompact ? "hidden items-center gap-1.5 px-0 md:flex" : "gap-0.5 px-1"
          }`}
        >
          {paths.length === 0 && archived.length === 0 && !sidebarInnerCompact ? (
            <p className="px-2 py-2 text-xs leading-relaxed text-[var(--ink-muted)]">Your paths appear here.</p>
          ) : null}
          {paths.map((project) => renderItem(project))}
          {archived.length > 0 && !sidebarInnerCompact ? (
            <p className="mt-4 px-2 pb-1 text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Archived</p>
          ) : null}
          {archived.map((project) => renderItem(project))}
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
                  avatarBox: { width: sidebarInnerCompact ? "2.25rem" : "2.5rem", height: sidebarInnerCompact ? "2.25rem" : "2.5rem" },
                  userButtonAvatarBox: {
                    width: sidebarInnerCompact ? "2.25rem" : "2.5rem",
                    height: sidebarInnerCompact ? "2.25rem" : "2.5rem",
                  },
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

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-12 md:pt-0">
        <div data-learn-scroll className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {children}
        </div>
      </div>
    </div>
  );
}
