/**
 * Map cloudflare:workers onto the test stub so route modules load under node.
 * Also resolve the @/ alias and extensionless TypeScript imports used by the Learn pipeline.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

function fileUrl(base) {
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}.mjs`, path.join(base, "index.ts"), base];
  const file = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return file ? pathToFileURL(file).href : null;
}

function aliasUrl(specifier) {
  if (!specifier.startsWith("@/")) return null;
  return fileUrl(path.join(root, specifier.slice(2)));
}

function relativeUrl(specifier, parentURL) {
  if (!specifier.startsWith(".") || !parentURL) return null;
  return fileUrl(path.resolve(path.dirname(fileURLToPath(parentURL)), specifier));
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      shortCircuit: true,
      url: new URL("./cloudflare-workers-stub.ts", import.meta.url).href,
    };
  }
  const aliased = aliasUrl(specifier) ?? relativeUrl(specifier, context.parentURL);
  if (aliased) return { shortCircuit: true, url: aliased };
  return nextResolve(specifier, context);
}
