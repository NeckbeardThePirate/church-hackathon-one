import {
  clearLocalProjects,
  readLocalProjects,
  type Project,
} from "./projects";

const PERSPECTIVE_KEY = "learn-perspective";

async function readError(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw.trim()) return `Request failed (${response.status}).`;
  try {
    const body = JSON.parse(raw) as { error?: string };
    return body.error || raw.slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}

export async function fetchWorkspace(): Promise<Project[]> {
  const response = await fetch("/api/workspace", { credentials: "same-origin" });
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { projects?: Project[] };
  return Array.isArray(body.projects) ? body.projects : [];
}

export async function putProject(project: Project): Promise<void> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(project.id)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project }),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function deleteRemoteProject(id: string): Promise<void> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await readError(response));
}

async function fetchPref(key: string): Promise<string | null> {
  const response = await fetch(`/api/workspace/prefs/${key}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { value?: string | null };
  return typeof body.value === "string" ? body.value : null;
}

async function savePref(key: string, value: string): Promise<void> {
  const response = await fetch(`/api/workspace/prefs/${key}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error(await readError(response));
}

/**
 * Load the signed-in user's learning paths from their Durable Object.
 * Leftover local notes are uploaded once (including a partial earlier upload), then the local copy is dropped.
 * Saved lesson/study projects from earlier versions load unchanged (they open read-only).
 */
export async function loadUserWorkspace(): Promise<Project[]> {
  const remote = await fetchWorkspace();
  const local = readLocalProjects();
  const remoteIds = new Set(remote.map((project) => project.id));
  const merged = [...remote];

  for (const project of local) {
    if (remoteIds.has(project.id)) continue;
    await putProject(project);
    merged.push(project);
    remoteIds.add(project.id);
  }

  if (merged.length === 0) {
    clearLocalProjects();
    return [];
  }

  clearLocalProjects();
  merged.sort((a, b) => b.updatedAt - a.updatedAt);
  return merged;
}

export async function fetchLearnPerspective(): Promise<string | null> {
  try {
    return await fetchPref(PERSPECTIVE_KEY);
  } catch {
    return null;
  }
}

export async function saveLearnPerspective(value: string): Promise<void> {
  await savePref(PERSPECTIVE_KEY, value);
}
