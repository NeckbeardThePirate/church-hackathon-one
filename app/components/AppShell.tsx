"use client";

import { UserButton } from "@clerk/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useClerkKey } from "./ClerkAppProvider";
import { signOutButtonClass } from "./clerk-appearance";
import { sidebarRailClass } from "./sidebar-rail";
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

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <path d="M7 1.75v10.5M1.75 7h10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path
        d={collapsed ? "M6 3.25 10.75 8 6 12.75" : "M10 3.25 5.25 8 10 12.75"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const [railOverride, setRailOverride] = useState<boolean | null>(null);
  const figures = statsFigures(stats);
  const railCollapsed = railOverride ?? sidebarCompact;

  useEffect(() => {
    setRailOverride(null);
  }, [sidebarCompact]);

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

  const toggleRail = useCallback(() => {
    setRailOverride(!(railOverride ?? sidebarCompact));
  }, [railOverride, sidebarCompact]);

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

  const renderItem = (project: Project) => {
    const active = project.id === activeProjectId;
    const archivedItem = isLegacyProject(project);
    const failed = Boolean(project.learnFailed && !project.importComplete);
    const label = `${defaultTitle(project)}${archivedItem ? " (archived)" : ""}`;
    const dotClass = `shrink-0 rounded-full ${archivedItem ? "bg-[var(--line)]" : failed ? "bg-[#c0533f]" : "bg-[#89b09a]"}`;
    const rowTone = active
      ? "bg-[var(--sidebar-active)] text-[var(--ink)]"
      : "text-[var(--ink-muted)] hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)] hover:text-[var(--ink)]";
    const railTone = active
      ? "bg-[var(--sidebar-active)] text-[var(--ink)] ring-1 ring-[color-mix(in_srgb,var(--accent)_28%,var(--line))]"
      : "text-[var(--ink-muted)] hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)] hover:text-[var(--ink)]";

    return (
      <div key={project.id} className="contents">
        <div className={`flex min-h-11 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors ${rowTone} ${railCollapsed ? "md:hidden" : ""}`}>
          <button
            type="button"
            onClick={() => selectProject(project.id)}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left ${focusRing}`}
          >
            <span aria-hidden className={`${dotClass} size-2`} />
            <span className="min-w-0 flex-1 truncate">
              {defaultTitle(project)}
              {failed ? (
                <span className="ml-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#c0533f]">Failed</span>
              ) : null}
            </span>
          </button>
          {!archivedItem && onRequestDelete ? (
            <button
              type="button"
              aria-label={`Remove ${defaultTitle(project)}`}
              onClick={() => onRequestDelete(project.id)}
              className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md text-base leading-none text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] ${focusRing}`}
            >
              ×
            </button>
          ) : null}
        </div>
        {railCollapsed ? (
          <button
            type="button"
            onClick={() => selectProject(project.id)}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`hidden size-9 shrink-0 items-center justify-center rounded-md transition-colors md:inline-flex ${railTone} ${focusRing}`}
          >
            <span aria-hidden className={`${dotClass} size-2.5`} />
          </button>
        ) : null}
      </div>
    );
  };

  const signOut = () => {
    void fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" }).finally(() => {
      const clerk = (window as unknown as { Clerk?: { signOut: (opts?: { redirectUrl?: string }) => Promise<void> } }).Clerk;
      if (clerk?.signOut) {
        void clerk.signOut({ redirectUrl: "/" });
        return;
      }
      window.location.assign("/");
    });
  };

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <header className="safe-area-top fixed inset-x-0 top-0 z-50 flex h-12 min-w-0 items-center gap-2 overflow-hidden border-b border-[var(--line)] bg-[var(--sidebar)] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--ink)] hover:bg-[var(--sidebar-active)] ${focusRing}`}
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
        <p
          className="min-w-0 max-w-[5.5rem] truncate text-right text-[11px] tabular-nums text-[var(--ink-muted)]"
          aria-label="Learner stats"
          aria-busy={figures.busy}
        >
          {figures.busy ? (
            <span className="study-shimmer inline-block h-3 w-12 rounded-full bg-[var(--line)]" aria-hidden />
          ) : (
            `${figures.xp} XP · ${figures.streak}d`
          )}
        </p>
        <button
          type="button"
          onClick={openNewProject}
          className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink-muted)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)] ${focusRing}`}
          aria-label="New path"
        >
          <PlusIcon />
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
        className={`fixed inset-y-0 left-0 z-[60] flex w-[min(100vw-2.5rem,18rem)] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--sidebar)] pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] transition-transform duration-300 ease-out md:static md:z-auto md:min-h-0 md:overflow-hidden md:transition-[width] md:duration-200 md:ease-out ${sidebarRailClass(railCollapsed)} ${
          mobileNavOpen ? "translate-x-0 px-3" : "max-md:pointer-events-none max-md:-translate-x-full px-3 md:translate-x-0"
        }`}
        aria-label="Learn paths"
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-1 md:hidden">
          <p className="text-sm font-medium text-[var(--ink)]">StudyBuddy</p>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className={`inline-flex size-11 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] ${focusRing}`}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <div
          className={`hidden md:flex ${
            railCollapsed ? "mb-1 w-full flex-col items-center gap-1.5 pb-2" : "mb-1 items-center justify-between gap-2 px-1 pb-3"
          }`}
        >
          {railCollapsed ? null : (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-none tracking-[-0.011em] text-[var(--ink)]">StudyBuddy</p>
              <p className="mt-1 truncate text-[11px] leading-none text-[var(--ink-muted)]">Learn paths</p>
            </div>
          )}
          <div className={railCollapsed ? "flex flex-col items-center gap-1.5" : "flex shrink-0 items-center gap-1"}>
            {railCollapsed ? (
              <button
                type="button"
                onClick={toggleRail}
                aria-expanded={false}
                aria-controls="learn-paths-nav"
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className={`inline-flex size-9 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] ${focusRing}`}
              >
                <SidebarToggleIcon collapsed />
              </button>
            ) : null}
            <button
              type="button"
              onClick={openNewProject}
              title="New path"
              aria-label="New path"
              className={`border border-[var(--line)] font-medium leading-none text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] hover:bg-[var(--sidebar-active)] ${focusRing} ${
                railCollapsed
                  ? "inline-flex size-9 items-center justify-center rounded-md"
                  : "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md px-2.5 text-xs"
              }`}
            >
              {railCollapsed ? <PlusIcon /> : "New path"}
            </button>
            {railCollapsed ? null : (
              <button
                type="button"
                onClick={toggleRail}
                aria-expanded
                aria-controls="learn-paths-nav"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className={`inline-flex size-8 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] ${focusRing}`}
              >
                <SidebarToggleIcon collapsed={false} />
              </button>
            )}
          </div>
        </div>

        <div className={railCollapsed ? "px-1 md:hidden" : "px-1"}>
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
        </div>

        <nav
          id="learn-paths-nav"
          className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 [scrollbar-gutter:stable] ${
            railCollapsed ? "md:items-center md:gap-1.5 md:px-0 md:[scrollbar-gutter:stable_both-edges]" : ""
          }`}
        >
          {onShowProgress ? (
            <button
              type="button"
              onClick={() => {
                onShowProgress();
                setMobileNavOpen(false);
              }}
              className={`flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)] hover:text-[var(--ink)] md:h-9 md:min-h-0 ${focusRing} ${
                railCollapsed ? "md:hidden" : ""
              }`}
            >
              Progress
            </button>
          ) : null}
          {paths.length === 0 && archived.length === 0 ? (
            <p className={`px-2 pb-1 pt-1 text-xs leading-5 text-[var(--ink-muted)] ${railCollapsed ? "md:hidden" : ""}`}>
              Your paths appear here.
            </p>
          ) : null}
          {paths.map((project) => renderItem(project))}
          {archived.length > 0 ? (
            <p
              className={`mt-3 px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)] ${
                railCollapsed ? "md:hidden" : ""
              }`}
            >
              Archived
            </p>
          ) : null}
          {archived.map((project) => renderItem(project))}
        </nav>

        <div
          className={`relative mt-auto flex items-center gap-2 border-t border-[var(--line)] px-1 pt-3 ${
            railCollapsed ? "md:justify-center md:px-0" : ""
          }`}
        >
          {clerkKey ? (
            <div className="sidebar-account flex size-9 shrink-0 items-center justify-center">
              <UserButton
                appearance={{
                  elements: {
                    rootBox: { width: "auto", height: "auto" },
                    userButtonBox: { width: "2.25rem", height: "2.25rem" },
                    userButtonTrigger: { width: "2.25rem", height: "2.25rem" },
                    avatarBox: { width: "2.25rem", height: "2.25rem" },
                    userButtonAvatarBox: { width: "2.25rem", height: "2.25rem" },
                    userButtonPopoverActionButton__signOut: signOutButtonClass,
                    userButtonPopoverActionButton__signOutAll: signOutButtonClass,
                  },
                }}
              />
            </div>
          ) : null}
          <button
            type="button"
            onClick={signOut}
            className={`${signOutButtonClass} sign-out-button-sidebar ml-auto ${railCollapsed ? "sign-out-button-rail" : ""}`}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-12 md:pt-0">
        <div data-learn-scroll className="min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto [scrollbar-gutter:stable]">
          {children}
        </div>
      </div>
    </div>
  );
}
