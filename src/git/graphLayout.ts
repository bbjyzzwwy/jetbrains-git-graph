import type {
  CommitNode,
  GraphLayoutResult,
  LaneInfo,
  LaneLine,
  LaneRoutePoint,
  LaneSnapshot,
} from "./types";

const MAIN_BRANCH_NAMES = new Set(["master", "main", "develop", "trunk"]);

/**
 * Stable color derived from a commit hash (0-7). Independent of render order,
 * so the same branch gets the same color in full-log and filtered views.
 */
function commitHashColor(hash: string): number {
  let n = 0;
  const len = Math.min(hash.length, 8);
  for (let i = 0; i < len; i++) {
    n = ((n << 4) | Number.parseInt(hash[i], 16)) >>> 0;
  }
  return n % 8;
}

/**
 * Compute graph layout for a list of commits.
 * Uses a greedy lane allocation algorithm with activeLanes tracking.
 * Supports cross-page stability via LaneSnapshot.
 *
 * Lane reservation invariant: when commit A at col C converges into parent P
 * that already occupies col C', we keep activeLanes[C] = P (rather than null)
 * so the column stays visually reserved until P's row is drawn. The reservation
 * is cleaned up at the top of the loop when P is actually processed.
 *
 * Colors are derived from commit hashes (not insertion order) so they remain
 * stable whether showing all branches or a filtered subset.
 *
 * Display columns follow the same broad idea as JetBrains' VCS Log print
 * graph: keep topology lanes for edges, then sort the node plus visible edges
 * per row by a permanent branch priority. This lets late non-main branch tips
 * use the leftmost column until a higher-priority branch/edge appears.
 */
export function computeGraphLayout(
  commits: CommitNode[],
  prevSnapshot?: LaneSnapshot,
  breakHiddenParents = false,
  colorSourceCommits = commits,
): GraphLayoutResult {
  const activeLanes: (string | null)[] = prevSnapshot
    ? [...prevSnapshot.activeLanes]
    : [];
  const laneColors: (number | null)[] = prevSnapshot?.laneColors
    ? [...prevSnapshot.laneColors]
    : activeLanes.map(() => null);
  while (laneColors.length < activeLanes.length) {
    laneColors.push(null);
  }
  const nextColorIndex = prevSnapshot?.nextColorIndex ?? 0; // kept for snapshot compat, unused

  const visibleSet = breakHiddenParents
    ? new Set(commits.map((c) => c.hash))
    : null;

  const lanes = new Map<string, LaneInfo>();

  for (const commit of commits) {
    // Find the lane this commit is expected in
    let col = activeLanes.indexOf(commit.hash);

    if (col === -1) {
      // New branch: assign a free lane
      col = findFreeOrAppend(activeLanes, laneColors);
      activeLanes[col] = commit.hash;
    }

    // Release convergence reservations from earlier commits that pointed here.
    // (Other lanes may hold commit.hash as a "reserved diagonal" placeholder.)
    for (let i = 0; i < activeLanes.length; i++) {
      if (i !== col && activeLanes[i] === commit.hash) {
        activeLanes[i] = null;
        laneColors[i] = null;
      }
    }

    if (laneColors[col] === null || laneColors[col] === undefined) {
      laneColors[col] = commitHashColor(commit.hash);
    }
    const color = laneColors[col] ?? 0;
    const lines: LaneLine[] = [];

    // Process parents
    if (commit.parents.length === 0) {
      // Root commit: lane ends
      activeLanes[col] = null;
      laneColors[col] = null;
    } else {
      const firstParent = commit.parents[0];
      const firstParentHidden =
        visibleSet !== null && !visibleSet.has(firstParent);

      if (firstParentHidden) {
        // Hidden parent in filter mode: keep relation metadata but end lane.
        lines.push({
          fromColumn: col,
          toColumn: col,
          toCommit: firstParent,
          type: "straight",
          hiddenParent: true,
        });
        activeLanes[col] = null;
        laneColors[col] = null;
      } else {
        // First parent continues in the same column
        const existingFirstParentCol = activeLanes.indexOf(firstParent);
        if (existingFirstParentCol !== -1 && existingFirstParentCol !== col) {
          // First parent already has a lane elsewhere: draw convergence line and
          // keep this column reserved (= firstParent) so no other commit reuses
          // it before firstParent's row is drawn.
          lines.push({
            fromColumn: col,
            toColumn: existingFirstParentCol,
            toCommit: firstParent,
            type: existingFirstParentCol < col ? "merge-left" : "merge-right",
          });
          activeLanes[col] = firstParent; // reservation — freed when firstParent is processed
        } else if (existingFirstParentCol === col) {
          // Already in the right lane
          lines.push({
            fromColumn: col,
            toColumn: col,
            toCommit: firstParent,
            type: "straight",
          });
        } else {
          // First parent not yet in any lane: continues in same column
          activeLanes[col] = firstParent;
          lines.push({
            fromColumn: col,
            toColumn: col,
            toCommit: firstParent,
            type: "straight",
          });
        }
      }

      // Additional parents (merge commit)
      for (let i = 1; i < commit.parents.length; i++) {
        const parent = commit.parents[i];

        // Hidden parent in filter mode: keep relation metadata, but do not
        // allocate lanes for invisible commits.
        if (visibleSet !== null && !visibleSet.has(parent)) {
          lines.push({
            fromColumn: col,
            toColumn: col,
            toCommit: parent,
            type: "straight",
            hiddenParent: true,
          });
          continue;
        }

        const existingParentCol = activeLanes.indexOf(parent);

        if (existingParentCol !== -1) {
          // Parent already tracked: draw merge line (no reservation needed —
          // that lane already owns the parent slot).
          lines.push({
            fromColumn: col,
            toColumn: existingParentCol,
            toCommit: parent,
            type: existingParentCol < col ? "merge-left" : "merge-right",
          });
        } else {
          // Fork: assign a new lane for this parent
          const forkCol = findFreeOrAppend(activeLanes, laneColors);
          activeLanes[forkCol] = parent;
          laneColors[forkCol] = null; // assigned when parent commit is processed
          lines.push({
            fromColumn: col,
            toColumn: forkCol,
            toCommit: parent,
            type: forkCol < col ? "fork-left" : "fork-right",
          });
        }
      }
    }

    lanes.set(commit.hash, { column: col, color: color % 8, lines });
  }

  applyJetBrainsStyleDisplayColumns(commits, lanes);
  applyBranchColors(commits, lanes, colorSourceCommits);

  compactLanes(activeLanes, laneColors);

  // Convert Map to Record for JSON serialization
  const lanesRecord: Record<string, LaneInfo> = {};
  for (const [key, value] of lanes) {
    lanesRecord[key] = value;
  }

  return {
    graphData: {
      commits,
      lanes: lanesRecord,
    },
    snapshot: {
      activeLanes: [...activeLanes],
      laneColors: [...laneColors],
      nextColorIndex,
    },
  };
}

type LayoutElement =
  | { kind: "node"; hash: string }
  | { kind: "edge"; upHash: string; downHash: string };

function applyJetBrainsStyleDisplayColumns(
  commits: CommitNode[],
  lanes: Map<string, LaneInfo>,
): void {
  if (commits.length === 0) {
    return;
  }

  const rowIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    rowIndex.set(commits[i].hash, i);
  }

  const layoutIndex = buildPermanentLayoutIndexes(commits, rowIndex);
  const nodeColumns = new Map<string, number>();
  const edgeRoutes = new Map<string, LaneRoutePoint[]>();

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    const elements: LayoutElement[] = [{ kind: "node", hash: commit.hash }];

    for (const source of commits) {
      const sourceRow = rowIndex.get(source.hash);
      if (sourceRow === undefined || sourceRow >= row) {
        continue;
      }

      const lane = lanes.get(source.hash);
      if (!lane) {
        continue;
      }

      for (const line of lane.lines) {
        if (line.hiddenParent) {
          continue;
        }

        const targetRow = rowIndex.get(line.toCommit);
        if (targetRow !== undefined && row < targetRow) {
          elements.push({
            kind: "edge",
            upHash: source.hash,
            downHash: line.toCommit,
          });
        }
      }
    }

    elements.sort((a, b) => compareLayoutElements(a, b, layoutIndex, rowIndex));
    for (let column = 0; column < elements.length; column++) {
      const element = elements[column];
      if (element.kind === "node") {
        if (element.hash === commit.hash) {
          nodeColumns.set(commit.hash, column);
        }
        continue;
      }

      const key = edgeKey(element.upHash, element.downHash);
      const route = edgeRoutes.get(key);
      const point = { commit: commit.hash, column };
      if (route) {
        route.push(point);
      } else {
        edgeRoutes.set(key, [point]);
      }
    }
  }

  for (const commit of commits) {
    const lane = lanes.get(commit.hash);
    const column = nodeColumns.get(commit.hash);
    if (!lane || column === undefined) {
      continue;
    }

    lane.column = column;
    for (const line of lane.lines) {
      line.fromColumn = column;
      const targetColumn = nodeColumns.get(line.toCommit);
      if (targetColumn !== undefined) {
        line.toColumn = targetColumn;
      }
      line.route = edgeRoutes.get(edgeKey(commit.hash, line.toCommit));
    }
  }
}

function edgeKey(upHash: string, downHash: string): string {
  return `${upHash}\x00${downHash}`;
}

function applyBranchColors(
  commits: CommitNode[],
  lanes: Map<string, LaneInfo>,
  colorSourceCommits: CommitNode[],
): void {
  if (commits.length === 0) {
    return;
  }

  const rowIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    rowIndex.set(commits[i].hash, i);
  }

  const colorRowIndex = new Map<string, number>();
  for (let i = 0; i < colorSourceCommits.length; i++) {
    colorRowIndex.set(colorSourceCommits[i].hash, i);
  }

  const heads = getOrderedHeads(colorSourceCommits, colorRowIndex);
  const globalCommitColors = buildCommitColors(colorSourceCommits, heads);
  const commitColors = new Map<string, number>();

  for (const commit of commits) {
    const globalColor = globalCommitColors.get(commit.hash);
    if (globalColor !== undefined) {
      commitColors.set(commit.hash, globalColor);
    }
  }

  const visibleHeads = getOrderedHeads(commits, rowIndex);
  for (const head of visibleHeads) {
    const color = commitColors.get(head.hash) ?? commitHashColor(head.hash);
    let current: CommitNode | undefined = head;
    while (current && !commitColors.has(current.hash)) {
      commitColors.set(current.hash, color);

      let nextParent: CommitNode | undefined;
      for (const parentHash of current.parents) {
        const parentRow = rowIndex.get(parentHash);
        if (parentRow === undefined) {
          continue;
        }
        const parent = commits[parentRow];
        if (!commitColors.has(parent.hash)) {
          nextParent = parent;
          break;
        }
      }
      current = nextParent;
    }
  }

  for (const commit of commits) {
    if (!commitColors.has(commit.hash)) {
      commitColors.set(commit.hash, commitHashColor(commit.hash));
    }
  }

  for (const commit of commits) {
    const lane = lanes.get(commit.hash);
    const color = commitColors.get(commit.hash);
    if (lane && color !== undefined) {
      lane.color = color;
    }
  }
}

function buildCommitColors(
  commits: CommitNode[],
  heads: CommitNode[],
): Map<string, number> {
  const rowIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    rowIndex.set(commits[i].hash, i);
  }

  const commitColors = new Map<string, number>();
  const usedHeadColors = new Set<number>();

  for (const head of heads) {
    const preferredColor = commitHashColor(head.hash);
    const color = pickAvailableColor(preferredColor, usedHeadColors);
    usedHeadColors.add(color);

    let current: CommitNode | undefined = head;
    while (current && !commitColors.has(current.hash)) {
      commitColors.set(current.hash, color);

      let nextParent: CommitNode | undefined;
      for (const parentHash of current.parents) {
        const parentRow = rowIndex.get(parentHash);
        if (parentRow === undefined) {
          continue;
        }
        const parent = commits[parentRow];
        if (!commitColors.has(parent.hash)) {
          nextParent = parent;
          break;
        }
      }
      current = nextParent;
    }
  }

  for (const commit of commits) {
    if (!commitColors.has(commit.hash)) {
      commitColors.set(commit.hash, commitHashColor(commit.hash));
    }
  }

  return commitColors;
}

function pickAvailableColor(preferredColor: number, usedColors: Set<number>) {
  for (let offset = 0; offset < 8; offset++) {
    const color = (preferredColor + offset) % 8;
    if (!usedColors.has(color)) {
      return color;
    }
  }
  return preferredColor;
}

function buildPermanentLayoutIndexes(
  commits: CommitNode[],
  rowIndex: Map<string, number>,
): Map<string, number> {
  const heads = getOrderedHeads(commits, rowIndex);
  const layoutIndex = new Map<string, number>();
  let nextLayoutIndex = 1;

  for (const head of heads) {
    if (layoutIndex.has(head.hash)) {
      continue;
    }

    let current: CommitNode | undefined = head;
    while (current) {
      const firstVisit = !layoutIndex.has(current.hash);
      if (firstVisit) {
        layoutIndex.set(current.hash, nextLayoutIndex);
      }

      let nextParent: CommitNode | undefined;
      for (const parentHash of current.parents) {
        const parentRow = rowIndex.get(parentHash);
        if (parentRow === undefined) {
          continue;
        }
        const parent = commits[parentRow];
        if (!layoutIndex.has(parent.hash)) {
          nextParent = parent;
          break;
        }
      }

      if (!nextParent) {
        if (firstVisit) {
          nextLayoutIndex++;
        }
        break;
      }

      current = nextParent;
    }
  }

  for (const commit of commits) {
    if (!layoutIndex.has(commit.hash)) {
      layoutIndex.set(commit.hash, nextLayoutIndex++);
    }
  }

  return layoutIndex;
}

function getOrderedHeads(
  commits: CommitNode[],
  rowIndex: Map<string, number>,
): CommitNode[] {
  const children = new Map<string, string[]>();
  for (const commit of commits) {
    for (const parent of commit.parents) {
      const list = children.get(parent);
      if (list) {
        list.push(commit.hash);
      } else {
        children.set(parent, [commit.hash]);
      }
    }
  }

  return commits
    .filter((commit) => {
      const hasBranchRef = commit.refs.some(
        (ref) => ref.type === "branch" || ref.type === "remote-branch",
      );
      return hasBranchRef || (children.get(commit.hash)?.length ?? 0) === 0;
    })
    .sort((a, b) => {
      const aMain = isMainBranchCommit(a);
      const bMain = isMainBranchCommit(b);
      if (aMain !== bMain) {
        return aMain ? -1 : 1;
      }
      return (rowIndex.get(b.hash) ?? 0) - (rowIndex.get(a.hash) ?? 0);
    });
}

function isMainBranchCommit(commit: CommitNode): boolean {
  return commit.refs.some(
    (ref) => ref.type === "branch" && MAIN_BRANCH_NAMES.has(ref.name),
  );
}

function compareLayoutElements(
  a: LayoutElement,
  b: LayoutElement,
  layoutIndex: Map<string, number>,
  rowIndex: Map<string, number>,
): number {
  if (a.kind === "node" && b.kind === "node") {
    return 0;
  }
  if (a.kind === "edge" && b.kind === "node") {
    return compareEdgeAndNode(a, b, layoutIndex, rowIndex);
  }
  if (a.kind === "node" && b.kind === "edge") {
    return -compareEdgeAndNode(b, a, layoutIndex, rowIndex);
  }

  const edgeA = a as Extract<LayoutElement, { kind: "edge" }>;
  const edgeB = b as Extract<LayoutElement, { kind: "edge" }>;
  return (
    getEdgeLayoutIndex(edgeA, layoutIndex) -
      getEdgeLayoutIndex(edgeB, layoutIndex) ||
    (rowIndex.get(edgeA.upHash) ?? 0) - (rowIndex.get(edgeB.upHash) ?? 0) ||
    (rowIndex.get(edgeA.downHash) ?? 0) - (rowIndex.get(edgeB.downHash) ?? 0)
  );
}

function compareEdgeAndNode(
  edge: Extract<LayoutElement, { kind: "edge" }>,
  node: Extract<LayoutElement, { kind: "node" }>,
  layoutIndex: Map<string, number>,
  rowIndex: Map<string, number>,
): number {
  const edgeLayoutIndex = getEdgeLayoutIndex(edge, layoutIndex);
  const nodeLayoutIndex = layoutIndex.get(node.hash) ?? Number.MAX_SAFE_INTEGER;

  if (edgeLayoutIndex !== nodeLayoutIndex) {
    return edgeLayoutIndex - nodeLayoutIndex;
  }

  return (rowIndex.get(edge.upHash) ?? 0) - (rowIndex.get(node.hash) ?? 0);
}

function getEdgeLayoutIndex(
  edge: Extract<LayoutElement, { kind: "edge" }>,
  layoutIndex: Map<string, number>,
): number {
  return Math.max(
    layoutIndex.get(edge.upHash) ?? Number.MAX_SAFE_INTEGER,
    layoutIndex.get(edge.downHash) ?? Number.MAX_SAFE_INTEGER,
  );
}

/** Find the first null slot in activeLanes, or append a new slot */
function findFreeOrAppend(
  activeLanes: (string | null)[],
  laneColors: (number | null)[],
): number {
  const idx = activeLanes.indexOf(null);
  if (idx !== -1) {
    return idx;
  }
  activeLanes.push(null);
  laneColors.push(null);
  return activeLanes.length - 1;
}

/** Remove trailing null entries from activeLanes and laneColors */
function compactLanes(
  activeLanes: (string | null)[],
  laneColors: (number | null)[],
): void {
  while (
    activeLanes.length > 0 &&
    activeLanes[activeLanes.length - 1] === null
  ) {
    activeLanes.pop();
    laneColors.pop();
  }
}
