const PROJECT_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const USER_ID_PATTERN = /^user_[A-Za-z0-9]+$/;

export function assertProjectId(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Response(JSON.stringify({ error: "Invalid project id" }), { status: 400 });
  }
}

/** New uploads: scoped to the signed-in user. */
export function sourceImageKey(userId: string, projectId: string, fileName: string): string {
  assertProjectId(projectId);
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Response(JSON.stringify({ error: "Invalid user" }), { status: 400 });
  }
  if (!fileName || fileName.includes("/") || fileName.includes("..")) {
    throw new Response(JSON.stringify({ error: "Invalid file name" }), { status: 400 });
  }
  return `users/${userId}/projects/${projectId}/${fileName}`;
}

export function isSafeMediaKey(key: string): boolean {
  return parseOwnedMediaKey(key) !== null || parseLegacyMediaKey(key) !== null;
}

export function mediaKeyForUser(key: string, userId: string): boolean {
  const owned = parseOwnedMediaKey(key);
  if (owned) return owned.userId === userId;
  return parseLegacyMediaKey(key) !== null;
}

export function mediaKeyProjectId(key: string): string | null {
  return parseOwnedMediaKey(key)?.projectId ?? parseLegacyMediaKey(key)?.projectId ?? null;
}

export function keyBelongsToProject(key: string, userId: string, projectId: string): boolean {
  const owned = parseOwnedMediaKey(key);
  if (owned) return owned.userId === userId && owned.projectId === projectId;
  const legacy = parseLegacyMediaKey(key);
  return legacy?.projectId === projectId;
}

function parseOwnedMediaKey(key: string): { userId: string; projectId: string; fileName: string } | null {
  const parts = key.split("/");
  if (parts.length !== 5) return null;
  if (parts[0] !== "users" || parts[2] !== "projects") return null;
  const userId = parts[1] ?? "";
  const projectId = parts[3] ?? "";
  const fileName = parts[4] ?? "";
  if (!USER_ID_PATTERN.test(userId)) return null;
  if (!PROJECT_ID_PATTERN.test(projectId)) return null;
  if (!fileName || fileName.includes("..")) return null;
  return { userId, projectId, fileName };
}

function parseLegacyMediaKey(key: string): { projectId: string; fileName: string } | null {
  const parts = key.split("/");
  if (parts.length !== 3 || parts[0] !== "projects") return null;
  const projectId = parts[1] ?? "";
  const fileName = parts[2] ?? "";
  if (!PROJECT_ID_PATTERN.test(projectId)) return null;
  if (!fileName || fileName.includes("..")) return null;
  return { projectId, fileName };
}

export function parseMediaKeyFromPath(segments: string[]): string | null {
  if (segments.some((part) => !part || part === "." || part === "..")) return null;
  const key = segments.join("/");
  return isSafeMediaKey(key) ? key : null;
}

export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
