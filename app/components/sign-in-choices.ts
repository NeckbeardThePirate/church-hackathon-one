export type AuthProviders = { clerk: boolean; chatgpt: boolean; dev: boolean };

export type SignInChoiceVisibility = {
  /** Provider list has not arrived, and there is no error to show yet. */
  pending: boolean;
  /** Clerk is the only sign-in, so this card would only repeat it. */
  hidden: boolean;
  chatgpt: boolean;
  dev: boolean;
};

export const NO_AUTH_PROVIDERS: AuthProviders = { clerk: false, chatgpt: false, dev: false };

export function readAuthProviders(body: unknown): AuthProviders {
  if (!body || typeof body !== "object") return NO_AUTH_PROVIDERS;
  const record = body as Partial<AuthProviders>;
  return {
    clerk: record.clerk === true,
    chatgpt: record.chatgpt === true,
    dev: record.dev === true,
  };
}

/** Which alternate sign-in actions to render for a providers payload. */
export function signInChoiceVisibility(providers: AuthProviders | null, hasError: boolean): SignInChoiceVisibility {
  const chatgpt = providers?.chatgpt === true;
  const dev = providers?.dev === true;
  if (!providers && !hasError) return { pending: true, hidden: true, chatgpt: false, dev: false };
  const hidden = Boolean(providers?.clerk && !chatgpt && !dev && !hasError);
  return { pending: false, hidden, chatgpt, dev };
}
