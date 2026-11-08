"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createProject, isLegacyProject, type Project } from "../lib/projects";
import { deleteRemoteProject, loadUserWorkspace, putProject } from "../lib/workspace-sync";
import { AppShell } from "./AppShell";
import type { LearnPlan } from "../lib/learn/types";
import type { LearnPlanProgress } from "../lib/learn/plan-progress";
import { ArchivedProjectView } from "./ArchivedProjectView";
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
        setProjects(loaded);
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

  const openProject = useCallback(
    (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      setActiveProjectId(projectId);
      if (project) setView(viewForProject(project));
    },
    [projects],
  );

  const showStart = useCallback(() => {
    setDraft(createProject());
    setActiveProjectId(null);
    setView("start");
  }, []);

  const startedPlan = useCallback(
    (planId: string) => {
      setProjects((prev) =>
        prev.some((p) => p.id === draft.id)
          ? prev.map((p) => (p.id === draft.id ? { ...p, learnPlanId: planId, updatedAt: Date.now() } : p))
          : [{ ...draft, learnPlanId: planId, updatedAt: Date.now() }, ...prev],
      );
      setActiveProjectId(draft.id);
      setView("building");
    },
    [draft],
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
      const project = activeProjectRef.current;
      updateProject(activeProjectId, {
        learnPlan: plan,
        learnPlanId: undefined,
        ...(project && !project.title.trim() ? { title: plan.title } : {}),
        importComplete: true,
      });
      setView("path");
    },
    [activeProjectId, updateProject],
  );

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
      >
        {view === "start" || !activeProject ? (
          <LearnIntakeStep key={draft.id} projectId={draft.id} onStarted={startedPlan} onComplete={completeLearnPlan} />
        ) : view === "building" ? (
          <LearnIntakeStep
            key={activeProject.id}
            projectId={activeProject.id}
            learnPlanId={activeProject.learnPlanId}
            onStarted={(planId) => updateProject(activeProject.id, { learnPlanId: planId })}
            onComplete={completeLearnPlan}
          />
        ) : !isLegacyProject(activeProject) && activeProject.learnPlan ? (
          <LearnPlanView
            key={activeProject.id}
            projectId={activeProject.id}
            plan={activeProject.learnPlan}
            displayTitle={activeProject.title}
            savedProgress={activeProject.learnProgress}
            onSaveProgress={saveLearnProgress}
          />
        ) : (
          <ArchivedProjectView
            key={activeProject.id}
            project={activeProject}
            onBuildPath={isLegacyProject(activeProject) ? undefined : rebuildPath}
          />
        )}
      </AppShell>
    </>
  );
}
