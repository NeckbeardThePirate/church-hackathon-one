"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorHistory, type BlocksChangeMeta } from "../hooks/useEditorHistory";
import {
  createProject,
  createSubpage,
  defaultTitle,
  type BlockContent,
  type Project,
  type ProjectKind,
  type SourceImage,
} from "../lib/projects";
import { deleteRemoteProject, loadUserWorkspace, putProject } from "../lib/workspace-sync";
import { plainTextToBlocks } from "../lib/text-blocks";
import { AppShell } from "./AppShell";
import { planToBlocks } from "../lib/learn/plan-to-blocks";
import type { LearnPlan } from "../lib/learn/types";
import type { LearnPlanProgress } from "../lib/learn/plan-progress";
import { ImageImportStep } from "./ImageImportStep";
import { LearnIntakeStep } from "./LearnIntakeStep";
import { LearnPlanView } from "./LearnPlanView";
import { NotionEditor } from "./NotionEditor";
import { ProjectPicker } from "./ProjectPicker";

type WorkspaceView = "picker" | "import" | "editor";

function viewForProject(project: Project): WorkspaceView {
  if (!project.importComplete) return "import";
  return "editor";
}

export function WorkspaceApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("picker");
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

  const editorHistory = useEditorHistory();
  const {
    reset: resetEditorHistory,
    setSnapshot: setEditorSnapshot,
    flush: flushEditorHistory,
    undo: undoEditorHistory,
    redo: redoEditorHistory,
    setOnPresentChange,
    canUndo,
    canRedo,
    revision: historyRevision,
  } = editorHistory;
  const lastHistorySessionRef = useRef<string | null>(null);

  const openProject = useCallback(
    (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      setActiveProjectId(projectId);
      if (project) setView(viewForProject(project));
    },
    [projects],
  );

  const showPicker = useCallback(() => {
    setActiveProjectId(null);
    setView("picker");
  }, []);

  const handlePickKind = useCallback((kind: ProjectKind) => {
    const project = createProject(kind);
    setProjects((prev) => [project, ...prev]);
    setActiveProjectId(project.id);
    setView("import");
  }, []);

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

  useEffect(() => {
    setOnPresentChange((snapshot) => {
      if (!activeProjectId) return;
      updateProject(activeProjectId, { title: snapshot.title, blocks: snapshot.blocks });
    });
  }, [activeProjectId, updateProject, setOnPresentChange]);

  useEffect(() => {
    if (view !== "editor" || !activeProjectId) {
      lastHistorySessionRef.current = null;
      return;
    }
    const sessionKey = `${activeProjectId}:${view}`;
    if (lastHistorySessionRef.current === sessionKey) return;
    lastHistorySessionRef.current = sessionKey;
    const project = activeProjectRef.current;
    if (!project || project.id !== activeProjectId) return;
    resetEditorHistory({ title: project.title, blocks: project.blocks });
  }, [activeProjectId, view, resetEditorHistory]);

  const completeImport = useCallback(
    (payload: {
      ocrText: string;
      rawOcrText?: string;
      sourceImages: SourceImage[];
      blocks: BlockContent[];
      suggestedTitle?: string;
    }) => {
      if (!activeProjectId) return;
      updateProject(activeProjectId, {
        sourceImages: payload.sourceImages,
        sourceImage: payload.sourceImages[0],
        ocrText: payload.rawOcrText ?? payload.ocrText,
        ...(payload.suggestedTitle?.trim() ? { title: payload.suggestedTitle.trim() } : {}),
        blocks: payload.blocks.length ? payload.blocks : plainTextToBlocks(payload.ocrText),
        importComplete: true,
      });
      setView("editor");
    },
    [activeProjectId, updateProject],
  );

  const completeLearnPlan = useCallback(
    (plan: LearnPlan) => {
      if (!activeProjectId) return;
      const project = activeProjectRef.current;
      updateProject(activeProjectId, {
        learnPlan: plan,
        learnPlanId: undefined,
        ...(project && !project.title.trim() ? { title: plan.title } : {}),
        blocks: planToBlocks(plan),
        importComplete: true,
      });
      setView("editor");
    },
    [activeProjectId, updateProject],
  );

  const skipImport = useCallback(() => {
    if (!activeProjectId) return;
    updateProject(activeProjectId, { importComplete: true });
    setView("editor");
  }, [activeProjectId, updateProject]);

  const handleEditorTitleChange = useCallback(
    (title: string) => {
      const project = activeProjectRef.current;
      if (!project) return;
      setEditorSnapshot({ title, blocks: project.blocks }, "grouped");
    },
    [setEditorSnapshot],
  );

  const handleEditorBlocksChange = useCallback(
    (blocks: BlockContent[], meta?: BlocksChangeMeta) => {
      const project = activeProjectRef.current;
      if (!project) return;
      setEditorSnapshot(
        { title: project.title, blocks },
        meta?.history ?? "immediate",
      );
    },
    [setEditorSnapshot],
  );

  const openPage = useCallback(
    (pageId: string) => {
      flushEditorHistory();
      setActiveProjectId(pageId);
      setView("editor");
    },
    [flushEditorHistory],
  );

  const handleCreateSubpage = useCallback((title: string, blocks: BlockContent[]): string | null => {
    const parent = activeProjectRef.current;
    if (!parent) return null;
    const page = createSubpage(parent, title, blocks);
    setProjects((prev) => [page, ...prev]);
    // Navigate after the parent's link block has been written.
    window.setTimeout(() => {
      flushEditorHistory();
      setActiveProjectId(page.id);
      setView("editor");
    }, 50);
    return page.id;
  }, [flushEditorHistory]);

  const resolvePageTitle = useCallback(
    (pageId: string) => {
      const page = projects.find((p) => p.id === pageId);
      return page ? defaultTitle(page) : null;
    },
    [projects],
  );

  const parentProject = activeProject?.parentId ? projects.find((p) => p.id === activeProject.parentId) : undefined;

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] text-sm text-[var(--ink-muted)]">
        Loading workspace…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--canvas)] px-6 text-center">
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
          className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-md rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-4 py-2 text-sm text-[var(--ink)]"
        >
          {syncError}
        </div>
      ) : null}
      <AppShell
      projects={projects}
      activeProjectId={activeProjectId}
      onSelectProject={openProject}
      onNewProject={showPicker}
      sidebarCompact={view === "import"}
    >
      {view === "picker" || !activeProject ? (
        <ProjectPicker onSelect={handlePickKind} />
      ) : view === "import" && activeProject.kind === "learn" ? (
        <LearnIntakeStep
          key={activeProject.id}
          learnPlanId={activeProject.learnPlanId}
          onStarted={(planId) => updateProject(activeProject.id, { learnPlanId: planId })}
          onComplete={completeLearnPlan}
          onSkip={skipImport}
        />
      ) : view === "import" ? (
        <ImageImportStep
          key={activeProject.id}
          projectId={activeProject.id}
          kind={activeProject.kind}
          onComplete={completeImport}
          onSkip={skipImport}
        />
      ) : activeProject.kind === "learn" && activeProject.learnPlan ? (
        <LearnPlanView
          key={activeProject.id}
          projectId={activeProject.id}
          plan={activeProject.learnPlan}
          displayTitle={activeProject.title}
          savedProgress={activeProject.learnProgress}
          onSaveProgress={saveLearnProgress}
        />
      ) : (
        <NotionEditor
          key={activeProject.id}
          kind={activeProject.kind}
          title={activeProject.title}
          blocks={activeProject.blocks}
          sourceImage={activeProject.sourceImage}
          sourceImages={activeProject.sourceImages ?? (activeProject.sourceImage ? [activeProject.sourceImage] : undefined)}
          onTitleChange={handleEditorTitleChange}
          onBlocksChange={handleEditorBlocksChange}
          onHistoryFlush={flushEditorHistory}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undoEditorHistory}
          onRedo={redoEditorHistory}
          historyRevision={historyRevision}
          parent={parentProject ? { id: parentProject.id, title: defaultTitle(parentProject) } : undefined}
          onCreateSubpage={handleCreateSubpage}
          onOpenPage={openPage}
          resolvePageTitle={resolvePageTitle}
        />
      )}
      </AppShell>
    </>
  );
}
