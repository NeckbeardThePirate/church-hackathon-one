/** Map cloudflare:workers onto the test stub so route modules load under node. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      shortCircuit: true,
      url: new URL("./cloudflare-workers-stub.ts", import.meta.url).href,
    };
  }
  return nextResolve(specifier, context);
}
