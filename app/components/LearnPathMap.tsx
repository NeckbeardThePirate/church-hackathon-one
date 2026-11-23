"use client";

import type { PathMapNode, PathNodeState } from "../lib/learn/path-map";

type Props = {
  nodes: PathMapNode[];
  onOpen: (nodeId: string) => void;
};

const STATE_LABEL: Record<PathNodeState, string> = {
  locked: "Locked",
  available: "Available",
  "in-progress": "In progress",
  "needs-review": "Needs review",
  mastered: "Mastered",
};

function finishFirst(titles: string[]): string {
  if (titles.length === 0) return "This step is still locked.";
  if (titles.length === 1) return `Finish ${titles[0]} first.`;
  if (titles.length === 2) return `Finish ${titles[0]} and ${titles[1]} first.`;
  return `Finish ${titles.slice(0, -1).join(", ")}, and ${titles[titles.length - 1]} first.`;
}

function stateClass(state: PathNodeState): string {
  switch (state) {
    case "mastered":
      return "text-[color-mix(in_srgb,#6b9f7a_85%,var(--ink))]";
    case "needs-review":
      return "text-[color-mix(in_srgb,#c97a7a_85%,var(--ink))]";
    case "in-progress":
      return "text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))]";
    default:
      return "text-[var(--ink-muted)]";
  }
}

function cardClass(node: PathMapNode): string {
  const base =
    "flex w-full min-w-0 max-w-full items-start rounded-xl border px-4 py-3 text-left transition-colors";
  if (node.state === "locked") {
    return `${base} cursor-default border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_72%,var(--canvas))]`;
  }
  if (node.current) {
    return `${base} border-[color-mix(in_srgb,var(--accent)_58%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] shadow-[inset_3px_0_0_var(--accent)] hover:border-[color-mix(in_srgb,var(--accent)_75%,var(--line))]`;
  }
  if (node.state === "mastered") {
    return `${base} border-[color-mix(in_srgb,#6b9f7a_45%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_10%,var(--sidebar))] hover:border-[color-mix(in_srgb,#6b9f7a_65%,var(--line))]`;
  }
  if (node.state === "needs-review") {
    return `${base} border-[color-mix(in_srgb,#c97a7a_45%,var(--line))] bg-[color-mix(in_srgb,#c97a7a_8%,var(--sidebar))] hover:border-[color-mix(in_srgb,#c97a7a_65%,var(--line))]`;
  }
  if (node.state === "in-progress") {
    return `${base} border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] bg-[var(--sidebar)] hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]`;
  }
  return `${base} border-[var(--line)] bg-[var(--sidebar)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]`;
}

function eyebrow(node: PathMapNode): string {
  if (node.kind === "final") return "Final";
  if (node.kind === "gap") return "Gap lesson";
  return `Lesson ${node.order}`;
}

function NodeCard({ node, onOpen }: { node: PathMapNode; onOpen: (nodeId: string) => void }) {
  const locked = node.state === "locked";
  const reason = locked ? finishFirst(node.unmet.map((item) => item.title)) : null;
  return (
    <button
      type="button"
      aria-disabled={locked}
      aria-current={node.current ? "step" : undefined}
      data-path-node={node.id}
      data-path-state={node.state}
      data-path-kind={node.kind}
      onClick={() => {
        if (locked) return;
        onOpen(node.id);
      }}
      className={cardClass(node)}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">
            {node.current ? (
              <span className="mr-2 text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))]">Current</span>
            ) : null}
            {eyebrow(node)}
          </span>
          <span className={`text-xs font-medium ${stateClass(node.state)}`}>{STATE_LABEL[node.state]}</span>
        </span>
        <span className={`mt-1 block text-sm font-medium leading-snug ${locked ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"}`}>
          {node.kind === "final" ? "Final assessment" : node.title}
        </span>
        {node.estimatedMinutes ? (
          <span className="mt-1 block text-xs text-[var(--ink-muted)]">{node.estimatedMinutes} min</span>
        ) : null}
        {reason ? <span className="mt-1 block text-xs leading-relaxed text-[var(--ink-muted)]">{reason}</span> : null}
      </span>
    </button>
  );
}

function groupsOf(nodes: PathMapNode[]): { head: PathMapNode; gaps: PathMapNode[] }[] {
  const groups: { head: PathMapNode; gaps: PathMapNode[] }[] = [];
  const byHead = new Map<string, { head: PathMapNode; gaps: PathMapNode[] }>();
  for (const node of nodes) {
    if (node.kind === "gap" && node.parentId) {
      const parent = byHead.get(node.parentId);
      if (parent) {
        parent.gaps.push(node);
        continue;
      }
    }
    const group = { head: node, gaps: [] as PathMapNode[] };
    groups.push(group);
    byHead.set(node.id, group);
  }
  return groups;
}

/** Vertical path of core lessons, gap lessons, and the final assessment. */
export function LearnPathMap({ nodes, onOpen }: Props) {
  const groups = groupsOf(nodes);
  if (!groups.length) return null;
  return (
    <ol className="mt-4 space-y-3 border-l border-[var(--line)] pl-3 sm:pl-4" aria-label="Path map">
      {groups.map((group) => (
        <li key={group.head.id} className="min-w-0">
          <NodeCard node={group.head} onOpen={onOpen} />
          {group.gaps.length ? (
            <ul className="mt-2 space-y-2 border-l border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] pl-3" aria-label={`Gap lessons for ${group.head.title}`}>
              {group.gaps.map((gap) => (
                <li key={gap.id} className="min-w-0">
                  <NodeCard node={gap} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
