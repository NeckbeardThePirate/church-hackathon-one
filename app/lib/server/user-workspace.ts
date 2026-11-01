import { env } from "cloudflare:workers";
import type { UserWorkspaceDO } from "./user-workspace-do";

export function userWorkspaceStub(userId: string): DurableObjectStub<UserWorkspaceDO> {
  // cf config infers DO bindings as DurableObjectNamespace<undefined>; cast to the class.
  const namespace = (env as unknown as { USER_WORKSPACE?: DurableObjectNamespace<UserWorkspaceDO> }).USER_WORKSPACE;
  if (!namespace) {
    throw new Error("USER_WORKSPACE binding is unavailable.");
  }
  return namespace.getByName(userId);
}
