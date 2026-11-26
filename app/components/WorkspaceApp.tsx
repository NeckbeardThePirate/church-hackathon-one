"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createProject, defaultTitle, isEmptyLearnPath, isLegacyProject, type Project } from "../lib/projects";
import { deleteRemoteProject, loadUserWorkspace, putProject } from "../lib/workspace-sync";
import { applyXpAwards, dailyGoalStatus, emptyStats, lessonMasteryList, type StatsSnapshot, type XpEvent, type XpEventKind } from "../lib/learn/learner-stats";
import { claimLegacyProgress, mergeLearnProgress, type LearnLocation, type LearnPlanProgress } from "../lib/learn/plan-progress";
import { actionTarget, nextLearningAction, pathSummaries, type NextAction } from "../lib/learn/progress-dashboard";
import { scopeFromProject } from "../lib/learn/progress-scope";
import { parsePathUrl } from "../lib/learn/path-url";
import { AppShell } from "./AppShell";
import { ProgressDashboard } from "./ProgressDashboard";
import type { LearnPlan } from "../lib/learn/types";
import { ArchivedProjectView } from "./ArchivedProjectView";
import { ConfirmDialog } from "./ConfirmDialog";
import { LearnIntakeStep } from "./LearnIntakeStep";
import { LearnPlanView } from "./LearnPlanView";

/** "start" is the new-path screen. "building" follows a started (or resumed) plan. */
type WorkspaceView = "start" | "building" | "path";

const PENDING_XP_KEY = "studybuddy-xp-pending";

type FocusRequest = { nonce: number; projectId: string; location: LearnLocation; review: boolean };

function readPendingAwards(): XpEvent[] {
  try {
    const raw = sessionStorage.getItem(PENDING_XP_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is XpEvent =>
        !!item &&
        typeof item === "object" &&
        typeof (item as XpEvent).reason === "string" &&
        typeof (item as XpEvent).kind === "string",
    );
  } catch {
    return [];
  }
}

function writePendingAwards(events: XpEvent[]) {
  try {
    if (!events.length) sessionStorage.removeItem(PENDING_XP_KEY);
    else sessionStorage.setItem(PENDING_XP_KEY, JSON.stringify(events));
  } catch {
    /* Storage can be unavailable. The in-memory total still shows until reload. */
  }
}

function viewForProject(project: Project): WorkspaceView {
  if (isLegacyProject(project)) return "path";
  return project.importComplete ? "path" : "building";
}

export function WorkspaceApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("start");
  const [draft, setDraft] = useState<Project>(() => createProject());
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [statsReady, setStatsReady] = useState(false);
  const [statsSaveError, setStatsSaveError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusNonceRef = useRef(0);
  const [liveProgress, setLiveProgress] = useState<LearnPlanProgress | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [missingPath, setMissingPath] = useState(false);
  const persistedRef = useRef<Map<string, string>>(new Map());
  const writeGenRef = useRef<Map<string, number>>(new Map());
  const syncReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    syncReadyRef.current = false;
    persistedRef.current.clear();
    writeGenRef.current.clear();
    setStatsReady(false);
    setLoadError(null);
    loadUserWorkspace()
      .then((loaded) => {
        if (cancelled) return;
        for (const project of loaded) {
          persistedRef.current.set(project.id, JSON.stringify(project));
        }
        syncReadyRef.current = true;
        setProjects(claimLegacyProgress(loaded).filter((project) => !isEmptyLearnPath(project)));
        setHydrated(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Could not load your notes.");
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!hydrated || !syncReadyRef.current) return;
    const timer = window.setTimeout(() => {
      const liveIds = new Set(projects.map((project) => project.id));
      for (const project of projects) {
        const json = JSON.stringify(project);
        if (persistedRef.current.get(project.id) === json) continue;
        const gen = (writeGenRef.current.get(project.id) ?? 0) + 1;
        writeGenRef.current.set(project.id, gen);
        void putProject(project)
          .then(() => {
            if (writeGenRef.current.get(project.id) !== gen) return;
            persistedRef.current.set(project.id, json);
            setSyncError(null);
          })
          .catch((error: unknown) => {
            if (writeGenRef.current.get(project.id) !== gen) return;
            setSyncError(error instanceof Error ? error.message : "Could not save a note.");
          });
      }
      for (const id of [...persistedRef.current.keys()]) {
        if (liveIds.has(id)) continue;
        const gen = (writeGenRef.current.get(id) ?? 0) + 1;
        writeGenRef.current.set(id, gen);
        persistedRef.current.delete(id);
        void deleteRemoteProject(id)
          .then(() => {
            if (writeGenRef.current.get(id) !== gen) return;
            setSyncError(null);
          })
          .catch((error: unknown) => {
            if (writeGenRef.current.get(id) !== gen) return;
            persistedRef.current.set(id, "");
            setSyncError(error instanceof Error ? error.message : "Could not delete a note.");
          });
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [projects, hydrated]);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeProjectRef = useRef(activeProject);
  activeProjectRef.current = activeProject;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const statsTimerRef = useRef<number | null>(null);
  const statsSaveGenRef = useRef(0);

  const writePathUrl = useCallback((pathId: string | null, mode: "push" | "replace") => {
    const params = new URLSearchParams(window.location.search);
    const samePath = Boolean(pathId) && params.get("path") === pathId;
    if (pathId) params.set("path", pathId);
    else params.delete("path");
    if (!pathId || !samePath) params.delete("lesson");
    if (!pathId) params.delete("review");
    const text = params.toString();
    const target = text ? `/?${text}` : "/";
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === target) return;
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", target);
  }, []);

  const openProject = useCallback(
    (projectId: string) => {
      const project = projectsRef.current.find((item) => item.id === projectId);
      setMissingPath(false);
      setLiveProgress(null);
      setActiveProjectId(projectId);
      if (project) setView(viewForProject(project));
      writePathUrl(projectId, "push");
    },
    [writePathUrl],
  );

  const showStart = useCallback(() => {
    setDraft(createProject());
    setActiveProjectId(null);
    setLiveProgress(null);
    setMissingPath(false);
    setView("start");
    writePathUrl(null, "push");
  }, [writePathUrl]);

  const openAction = useCallback(
    (action: NextAction) => {
      const target = actionTarget(action);
      if (!target) {
        showStart();
        window.setTimeout(() => document.getElementById("learn-start")?.scrollIntoView({ block: "start" }), 0);
        return;
      }
      const project = projectsRef.current.find((item) => item.id === target.projectId);
      if (!project) return;
      setMissingPath(false);
      setLiveProgress(null);
      setActiveProjectId(project.id);
      setView(viewForProject(project));
      focusNonceRef.current += 1;
      setFocusRequest({
        nonce: focusNonceRef.current,
        projectId: project.id,
        location: target.location,
        review: target.review,
      });
      const params = new URLSearchParams(window.location.search);
      params.set("path", project.id);
      if (target.location.screen === "overview") params.set("lesson", "home");
      else if (target.location.screen === "final") params.set("lesson", "final");
      else if (target.location.lessonId) params.set("lesson", target.location.lessonId);
      if (target.review) params.set("review", "1");
      else params.delete("review");
      const text = params.toString();
      window.history.pushState(null, "", text ? `/?${text}` : "/");
    },
    [showStart],
  );

  useEffect(() => {
    if (!hydrated) return;
    const parsed = parsePathUrl(window.location.search);
    if (!parsed.pathId) return;
    const project = projectsRef.current.find((item) => item.id === parsed.pathId);
    if (!project) {
      setMissingPath(true);
      setView("start");
      return;
    }
    setActiveProjectId(project.id);
    setView(viewForProject(project));
  }, [hydrated]);

  useEffect(() => {
    const onPop = () => {
      const parsed = parsePathUrl(window.location.search);
      if (!parsed.pathId) {
        setActiveProjectId(null);
        setLiveProgress(null);
        setMissingPath(false);
        setView("start");
        return;
      }
      const project = projectsRef.current.find((item) => item.id === parsed.pathId);
      if (!project) {
        setMissingPath(true);
        setActiveProjectId(null);
        setView("start");
        return;
      }
      setMissingPath(false);
      setLiveProgress(null);
      setActiveProjectId(project.id);
      setView(viewForProject(project));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const flushAwards = useCallback(async () => {
    const pending = readPendingAwards();
    if (!pending.length) return;
    const zone = statsRef.current?.timezone || browserTimeZone();
    const gen = ++statsSaveGenRef.current;
    try {
      const response = await fetch("/api/workspace/stats/award", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: zone, events: pending }),
        keepalive: true,
      });
      if (statsSaveGenRef.current !== gen) return;
      if (!response.ok) {
        setStatsSaveError("Couldn't save XP. Reloading will retry the points you just earned.");
        return;
      }
      const saved = (await response.json()) as StatsSnapshot;
      const sent = new Set(pending.map((event) => event.reason));
      const remaining = readPendingAwards().filter((event) => !sent.has(event.reason));
      writePendingAwards(remaining);
      const merged = remaining.length
        ? applyXpAwards(saved, remaining, Date.now(), saved.timezone || zone).stats
        : saved;
      statsRef.current = merged;
      setStats(merged);
      setStatsSaveError(null);
    } catch {
      if (statsSaveGenRef.current === gen) {
        setStatsSaveError("Couldn't save XP. Reloading will retry the points you just earned.");
      }
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const showBlank = () => {
      if (statsRef.current) return;
      const blank = emptyStats();
      statsRef.current = blank;
      setStats(blank);
    };
    void fetch("/api/workspace/stats", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as StatsSnapshot;
      })
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded || typeof loaded.xp !== "number" || typeof loaded.streak !== "number") {
          showBlank();
          return;
        }
        const pending = readPendingAwards();
        const zone = loaded.timezone || browserTimeZone();
        const applied = pending.length ? applyXpAwards(loaded, pending, Date.now(), zone) : null;
        const next = applied && !applied.error ? applied.stats : loaded;
        statsRef.current = next;
        setStats(next);
        if (pending.length) void flushAwards();
      })
      .catch(() => {
        if (!cancelled) showBlank();
      })
      .finally(() => {
        if (!cancelled) setStatsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, flushAwards]);

  const award = useCallback(
    (reason: string, kind: XpEventKind) => {
      const zone = statsRef.current?.timezone || browserTimeZone();
      const result = applyXpAwards(statsRef.current ?? emptyStats(), [{ reason, kind }], Date.now(), zone);
      if (result.error) {
        setStatsSaveError(result.error);
        return;
      }
      if (!result.accepted.length) return;
      statsRef.current = result.stats;
      setStats(result.stats);
      const pending = readPendingAwards();
      if (!pending.some((event) => event.reason === reason)) pending.push({ reason, kind });
      writePendingAwards(pending);
      if (statsTimerRef.current) window.clearTimeout(statsTimerRef.current);
      statsTimerRef.current = window.setTimeout(() => {
        void flushAwards();
      }, 250);
    },
    [flushAwards],
  );

  useEffect(() => {
    const flush = () => {
      void flushAwards();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [flushAwards]);

  const startedPlan = useCallback(
    (planId: string, topic: string) => {
      const title = topic.trim().slice(0, 120);
      setProjects((prev) =>
        prev.some((p) => p.id === draft.id)
          ? prev.map((p) => (p.id === draft.id ? { ...p, title, learnPlanId: planId, updatedAt: Date.now() } : p))
          : [{ ...draft, title, learnPlanId: planId, updatedAt: Date.now() }, ...prev],
      );
      setActiveProjectId(draft.id);
      setView("building");
      writePathUrl(draft.id, "push");
    },
    [draft, writePathUrl],
  );

  const updateProject = useCallback((projectId: string, patch: Partial<Project>) => {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId ? { ...project, ...patch, updatedAt: Date.now() } : project,
      ),
    );
  }, []);

  const saveLearnProgress = useCallback(
    (projectId: string, learnProgress: LearnPlanProgress) => {
      updateProject(projectId, { learnProgress });
    },
    [updateProject],
  );

  const completeLearnPlan = useCallback(
    (plan: LearnPlan, opts?: { keepBuilding?: boolean }) => {
      if (!activeProjectId) return;
      const current = projectsRef.current.find((project) => project.id === activeProjectId);
      updateProject(activeProjectId, {
        learnPlan: plan,
        learnPlanId: opts?.keepBuilding ? current?.learnPlanId : undefined,
        ...(plan.title?.trim() ? { title: plan.title } : {}),
        importComplete: true,
      });
      setView("path");
    },
    [activeProjectId, updateProject],
  );

  const studyWhileBuilding = useCallback(
    (plan: LearnPlan) => {
      completeLearnPlan(plan, { keepBuilding: true });
    },
    [completeLearnPlan],
  );

  const markPathFailed = useCallback(() => {
    if (!activeProjectId) return;
    updateProject(activeProjectId, { learnFailed: true });
  }, [activeProjectId, updateProject]);

  const deleteProject = useCallback(
    (projectId: string) => {
      setProjects((prev) => prev.filter((project) => project.id !== projectId));
      setPendingDeleteId(null);
      if (activeProjectRef.current?.id === projectId) {
        setDraft(createProject());
        setActiveProjectId(null);
        setLiveProgress(null);
        setView("start");
        writePathUrl(null, "replace");
      }
    },
    [writePathUrl],
  );

  const pendingDelete = projects.find((project) => project.id === pendingDeleteId) ?? null;
  const mastery = useMemo(() => {
    if (!activeProject?.learnPlan || isLegacyProject(activeProject)) return [];
    const scope = scopeFromProject(activeProject);
    if (!scope) return [];
    const progress = mergeLearnProgress(liveProgress ?? activeProject.learnProgress, scope);
    return lessonMasteryList(
      activeProject.learnPlan.lessons.map((lesson) => ({
        id: lesson.id,
        order: lesson.order,
        title: lesson.title,
        quizCount: lesson.quiz.length,
      })),
      progress,
      scope,
    );
  }, [activeProject, liveProgress]);

  const dashboardProjects = useMemo(
    () =>
      projects.map((project) => {
        const scope = scopeFromProject(project);
        if (!scope || isLegacyProject(project)) return project;
        const base = project.id === activeProjectId && liveProgress ? liveProgress : project.learnProgress;
        return { ...project, learnProgress: mergeLearnProgress(base, scope) };
      }),
    [projects, activeProjectId, liveProgress],
  );
  const summaries = useMemo(() => pathSummaries(dashboardProjects, Date.now()), [dashboardProjects]);
  const nextAction = useMemo(() => nextLearningAction(dashboardProjects, Date.now()), [dashboardProjects]);
  const goal = dailyGoalStatus(stats, Date.now());

  const rebuildPath = useCallback(() => {
    if (!activeProjectId) return;
    updateProject(activeProjectId, { importComplete: false, learnPlanId: undefined });
    setView("building");
  }, [activeProjectId, updateProject]);

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] text-base text-[var(--ink-muted)]">
        Loading workspace…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="safe-area-x flex min-h-dvh flex-col items-center justify-center gap-3 bg-[var(--canvas)] px-6 text-center">
        <p className="text-sm text-[var(--ink)]">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setHydrated(false);
            setLoadAttempt((attempt) => attempt + 1);
          }}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink)] hover:bg-[var(--sidebar)]"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {syncError || statsSaveError ? (
        <div className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-col gap-2 safe-area-x">
          {statsSaveError ? (
            <p
              role="status"
              className="rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-4 py-2.5 text-sm text-[var(--ink)]"
            >
              {statsSaveError}
            </p>
          ) : null}
          {syncError ? (
            <p
              role="status"
              className="rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-4 py-2.5 text-sm text-[var(--ink)]"
            >
              {syncError}
            </p>
          ) : null}
        </div>
      ) : null}
      <AppShell
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={openProject}
        onNewProject={showStart}
        sidebarCompact={view === "building"}
        stats={statsReady && stats ? { xp: stats.xp, streak: stats.streak } : null}
        mastery={mastery}
        goal={statsReady && stats ? goal : null}
        nextLabel={nextAction.label}
        onNext={() => openAction(nextAction)}
        onShowProgress={showStart}
        onRequestDelete={setPendingDeleteId}
      >
        {missingPath && (view === "start" || !activeProject) ? (
          <p className="mx-auto w-full max-w-[720px] px-4 pt-14 text-sm text-[var(--ink-muted)] sm:px-10">
            That path isn’t in this workspace.
          </p>
        ) : null}
        {view === "start" || !activeProject ? (
          <div>
            <ProgressDashboard
              xp={stats?.xp ?? 0}
              streak={stats?.streak ?? 0}
              pending={!statsReady || !stats}
              goal={goal}
              summaries={summaries}
              action={nextAction}
              onOpen={openAction}
            />
            <LearnIntakeStep
              key={draft.id}
              projectId={draft.id}
              onStarted={startedPlan}
              onComplete={completeLearnPlan}
              onStudyReady={studyWhileBuilding}
            />
          </div>
        ) : view === "building" ? (
          <LearnIntakeStep
            key={activeProject.id}
            projectId={activeProject.id}
            learnPlanId={activeProject.learnPlanId}
            onStarted={(planId, topic) =>
              updateProject(activeProject.id, {
                learnPlanId: planId,
                learnFailed: false,
                ...(activeProject.title.trim() ? {} : { title: topic.trim().slice(0, 120) }),
              })
            }
            onComplete={completeLearnPlan}
            onStudyReady={studyWhileBuilding}
            onMarkFailed={markPathFailed}
            onRequestRemove={() => setPendingDeleteId(activeProject.id)}
          />
        ) : !isLegacyProject(activeProject) && activeProject.learnPlan ? (
          <LearnPlanView
            key={activeProject.id}
            projectId={activeProject.id}
            plan={activeProject.learnPlan}
            buildingPlanId={activeProject.learnPlanId}
            displayTitle={activeProject.title}
            savedProgress={activeProject.learnProgress}
            onSaveProgress={saveLearnProgress}
            onProgress={setLiveProgress}
            onAward={award}
            onPlan={(plan) => updateProject(activeProject.id, { learnPlan: plan })}
            onBuildComplete={completeLearnPlan}
            stats={statsReady && stats ? { xp: stats.xp, streak: stats.streak, timezone: stats.timezone } : null}
            focusRequest={focusRequest && focusRequest.projectId === activeProject.id ? focusRequest : null}
            goal={statsReady && stats ? goal : null}
          />
        ) : (
          <ArchivedProjectView
            key={activeProject.id}
            project={activeProject}
            onBuildPath={isLegacyProject(activeProject) ? undefined : rebuildPath}
          />
        )}
      </AppShell>
      {pendingDelete ? (
        <ConfirmDialog
          title="Remove this path?"
          body={`“${defaultTitle(pendingDelete)}” will be removed from your paths.`}
          confirmLabel="Remove"
          onConfirm={() => deleteProject(pendingDelete.id)}
          onClose={() => setPendingDeleteId(null)}
        />
      ) : null}
    </>
  );
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
