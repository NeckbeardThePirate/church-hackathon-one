"use client";

import type { PathMapNode, PathNodeState } from "../lib/learn/path-map";
import { useIdsLeft } from "./useIdsLeft";

type Props = {
  nodes: PathMapNode[];
  onOpen: (nodeId: string) => void;
  /** Marks a node that just appeared, such as the guest sample gap. */
  highlightId?: string | null;
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

function cardClass(node: PathMapNode, highlighted: boolean, arrived: boolean): string {
  const base =
    "flex w-full min-h-11 min-w-0 max-w-full items-start rounded-xl border px-3 py-3 text-left transition-[background-color,border-color,box-shadow] duration-500 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:px-4";
  const arrive = arrived ? " study-ready" : "";
  let tone: string;
  if (node.building) {
    tone =
      "border-dashed border-[color-mix(in_srgb,var(--accent)_50%,var(--line))] bg-[color-mix(in_srgb,var(--sidebar)_88%,var(--canvas))]";
  } else if (node.state === "locked") {
    tone = "cursor-default border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_72%,var(--canvas))]";
  } else if (highlighted) {
    tone =
      "border-[color-mix(in_srgb,var(--accent)_70%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_16%,var(--sidebar))] shadow-[inset_3px_0_0_var(--accent)] hover:border-[color-mix(in_srgb,var(--accent)_85%,var(--line))]";
  } else if (node.current) {
    tone =
      "border-[color-mix(in_srgb,var(--accent)_58%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] shadow-[inset_3px_0_0_var(--accent)] hover:border-[color-mix(in_srgb,var(--accent)_75%,var(--line))]";
  } else if (node.state === "mastered") {
    tone =
      "border-[color-mix(in_srgb,#6b9f7a_45%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_10%,var(--sidebar))] hover:border-[color-mix(in_srgb,#6b9f7a_65%,var(--line))]";
  } else if (node.state === "needs-review") {
    tone =
      "border-[color-mix(in_srgb,#c97a7a_45%,var(--line))] bg-[color-mix(in_srgb,#c97a7a_8%,var(--sidebar))] hover:border-[color-mix(in_srgb,#c97a7a_65%,var(--line))]";
  } else if (node.state === "in-progress") {
    tone =
      "border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] bg-[var(--sidebar)] hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]";
  } else {
    tone = "border-[var(--line)] bg-[var(--sidebar)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]";
  }
  return `${base}${arrive} ${tone}`;
}

function eyebrow(node: PathMapNode): string {
  if (node.kind === "final") return "Final";
  if (node.kind === "gap") return "Gap lesson";
  return `Lesson ${node.order}`;
}

function NodeCard({
  node,
  arrived,
  highlighted,
  onOpen,
}: {
  node: PathMapNode;
  arrived: boolean;
  highlighted: boolean;
  onOpen: (nodeId: string) => void;
}) {
  const locked = node.state === "locked";
  const reason = locked ? finishFirst(node.unmet.map((item) => item.title)) : null;
  const quiet = locked || node.building;
  return (
    <button
      type="button"
      aria-disabled={locked}
      aria-busy={node.building || undefined}
      aria-current={node.current ? "step" : undefined}
      data-path-node={node.id}
      data-path-state={node.state}
      data-path-kind={node.kind}
      data-path-building={node.building ? "true" : "false"}
      data-path-highlight={highlighted ? "true" : undefined}
      onClick={() => {
        if (locked) return;
        onOpen(node.id);
      }}
      className={cardClass(node, highlighted, arrived)}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">
            {node.current ? (
              <span className="mr-2 text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))]">Current</span>
            ) : null}
            {highlighted ? (
              <span className="mr-2 text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))]">New </span>
            ) : null}
            {eyebrow(node)}
          </span>
          <span className={`text-xs font-medium ${node.building ? "text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))]" : stateClass(node.state)}`}>
            {node.building ? "Building" : STATE_LABEL[node.state]}
          </span>
        </span>
        <span className={`mt-1 block break-words text-sm font-medium leading-snug ${quiet ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"}`}>
          {node.kind === "final" ? "Final assessment" : node.title}
        </span>
        {node.building ? <span className="study-shimmer mt-2 block h-1 w-24 max-w-full rounded-full bg-[var(--line)]" /> : null}
        {node.estimatedMinutes && !node.building ? (
          <span className="mt-1 block text-xs text-[var(--ink-muted)]">{node.estimatedMinutes} min</span>
        ) : null}
        {reason ? <span className="mt-1 block break-words text-xs leading-relaxed text-[var(--ink-muted)]">{reason}</span> : null}
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
export function LearnPathMap({ nodes, onOpen, highlightId = null }: Props) {
  const groups = groupsOf(nodes);
  const arrived = useIdsLeft(nodes.filter((node) => node.building).map((node) => node.id).join(","));
  if (!groups.length) return null;
  return (
    <ol className="mt-4 space-y-3 overflow-x-clip border-l border-[var(--line)] pl-2.5 sm:pl-4" aria-label="Path map">
      {groups.map((group) => (
        <li
          key={group.head.id}
          className={highlightId === group.head.id ? "path-node-enter min-w-0 scroll-mt-4" : "min-w-0 scroll-mt-4"}
        >
          <NodeCard
            node={group.head}
            arrived={arrived.has(group.head.id)}
            highlighted={highlightId === group.head.id}
            onOpen={onOpen}
          />
          {group.gaps.length ? (
            <ul className="mt-2 space-y-2 overflow-x-clip border-l border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] pl-2.5 sm:pl-3" aria-label={`Gap lessons for ${group.head.title}`}>
              {group.gaps.map((gap) => (
                <li
                  key={gap.id}
                  className={highlightId === gap.id ? "path-node-enter min-w-0 scroll-mt-4" : "min-w-0 scroll-mt-4"}
                >
                  <NodeCard
                    node={gap}
                    arrived={arrived.has(gap.id)}
                    highlighted={highlightId === gap.id}
                    onOpen={onOpen}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
