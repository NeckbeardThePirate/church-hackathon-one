"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createProject, defaultTitle, isEmptyLearnPath, isLegacyProject, type Project } from "../lib/projects";
import { deleteRemoteProject, loadUserWorkspace, putProject } from "../lib/workspace-sync";
import { awardLearning, emptyStats, lessonMasteryList, type StatsSnapshot } from "../lib/learn/learner-stats";
import { parsePathUrl } from "../lib/learn/path-url";
import { AppShell } from "./AppShell";
import type { LearnPlan } from "../lib/learn/types";
import type { LearnPlanProgress } from "../lib/learn/plan-progress";
import { ArchivedProjectView } from "./ArchivedProjectView";
import { ConfirmDialog } from "./ConfirmDialog";
import { LearnIntakeStep } from "./LearnIntakeStep";
import { LearnPlanView } from "./LearnPlanView";

/** "start" is the new-path screen. "building" follows a started (or resumed) plan. */
type WorkspaceView = "start" | "building" | "path";

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
    setLoadError(null);
    loadUserWorkspace()
      .then((loaded) => {
        if (cancelled) return;
        for (const project of loaded) {
          persistedRef.current.set(project.id, JSON.stringify(project));
        }
        syncReadyRef.current = true;
        setProjects(loaded.filter((project) => !isEmptyLearnPath(project)));
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

  const writePathUrl = useCallback((pathId: string | null, mode: "push" | "replace") => {
    const params = new URLSearchParams(window.location.search);
    const samePath = Boolean(pathId) && params.get("path") === pathId;
    if (pathId) params.set("path", pathId);
    else params.delete("path");
    if (!pathId || !samePath) params.delete("lesson");
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

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void fetch("/api/workspace/stats", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as StatsSnapshot;
      })
      .then((loaded) => {
        if (cancelled || !loaded || typeof loaded.xp !== "number") return;
        const local = statsRef.current;
        const localNewer =
          local != null &&
          ((local.last_activity_at ?? 0) > (loaded.last_activity_at ?? 0) || local.xp > loaded.xp);
        if (localNewer) return;
        statsRef.current = loaded;
        setStats(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const award = useCallback((reason: string, amount: number) => {
    const zone = statsRef.current?.timezone || browserTimeZone();
    const next = awardLearning(statsRef.current ?? emptyStats(), { reason, amount }, Date.now(), zone);
    if (next === (statsRef.current ?? emptyStats()) && statsRef.current) return;
    statsRef.current = next;
    setStats(next);
    if (statsTimerRef.current) window.clearTimeout(statsTimerRef.current);
    statsTimerRef.current = window.setTimeout(() => {
      const snapshot = statsRef.current;
      if (!snapshot) return;
      void fetch("/api/workspace/stats", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      }).catch(() => undefined);
    }, 300);
  }, []);

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
    (learnProgress: LearnPlanProgress) => {
      const id = activeProjectRef.current?.id;
      if (!id) return;
      updateProject(id, { learnProgress });
    },
    [updateProject],
  );

  const completeLearnPlan = useCallback(
    (plan: LearnPlan) => {
      if (!activeProjectId) return;
      updateProject(activeProjectId, {
        learnPlan: plan,
        learnPlanId: undefined,
        ...(plan.title?.trim() ? { title: plan.title } : {}),
        importComplete: true,
      });
      setView("path");
    },
    [activeProjectId, updateProject],
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
    const progress = liveProgress ?? activeProject.learnProgress;
    if (!progress) return [];
    return lessonMasteryList(
      activeProject.learnPlan.lessons.map((lesson) => ({
        id: lesson.id,
        order: lesson.order,
        title: lesson.title,
        quizCount: lesson.quiz.length,
      })),
      progress,
    );
  }, [activeProject, liveProgress]);

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
      {syncError ? (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-50 mx-auto w-fit max-w-[calc(100vw-2rem)] rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-4 py-2.5 text-sm text-[var(--ink)] safe-area-x"
        >
          {syncError}
        </div>
      ) : null}
      <AppShell
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={openProject}
        onNewProject={showStart}
        sidebarCompact={view === "building"}
        stats={{ xp: stats?.xp ?? 0, streak: stats?.streak ?? 0 }}
        mastery={mastery}
        onRequestDelete={setPendingDeleteId}
      >
        {missingPath && (view === "start" || !activeProject) ? (
          <p className="mx-auto w-full max-w-[720px] px-4 pt-14 text-sm text-[var(--ink-muted)] sm:px-10">
            That path isn’t in this workspace.
          </p>
        ) : null}
        {view === "start" || !activeProject ? (
          <LearnIntakeStep key={draft.id} projectId={draft.id} onStarted={startedPlan} onComplete={completeLearnPlan} />
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
            onMarkFailed={markPathFailed}
            onRequestRemove={() => setPendingDeleteId(activeProject.id)}
          />
        ) : !isLegacyProject(activeProject) && activeProject.learnPlan ? (
          <LearnPlanView
            key={activeProject.id}
            projectId={activeProject.id}
            plan={activeProject.learnPlan}
            displayTitle={activeProject.title}
            savedProgress={activeProject.learnProgress}
            onSaveProgress={saveLearnProgress}
            onProgress={setLiveProgress}
            onAward={award}
            stats={{ xp: stats?.xp ?? 0, streak: stats?.streak ?? 0 }}
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
