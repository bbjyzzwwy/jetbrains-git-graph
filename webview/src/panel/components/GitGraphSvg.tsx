import { useMemo, useState } from "react";
import { usePanelStore } from "../../shared/store/panel-store";
import type {
  CollapsibleSequence,
  Commit,
  LaneInfo,
} from "../../shared/types/git";

const COLUMN_WIDTH = 10;
const ROW_HEIGHT = 28;
const GRAPH_PADDING = 6;
const VISIBLE_OVERSCAN = 8;
const LANE_COLORS = [
  "var(--graph-lane-blue)",
  "var(--graph-lane-red)",
  "var(--graph-lane-green)",
  "var(--graph-lane-yellow)",
  "var(--graph-lane-purple)",
  "var(--graph-lane-cyan)",
  "var(--graph-lane-orange)",
  "var(--graph-lane-teal)",
  "var(--graph-lane-pink)",
  "var(--graph-lane-lime)",
  "var(--graph-lane-indigo)",
  "var(--graph-lane-coral)",
];

function laneColor(colorIdx: number): string {
  return LANE_COLORS[colorIdx % LANE_COLORS.length];
}

function colX(col: number): number {
  return GRAPH_PADDING + col * COLUMN_WIDTH + COLUMN_WIDTH / 2;
}

function rowY(row: number): number {
  return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function linePath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  isStub?: boolean,
): string {
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  if (isStub) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  // IDEA-style: vertical → diagonal → vertical.
  // Use up to half the total span for the diagonal so convergence is visible.
  const totalDeltaY = toY - fromY;
  const diagonalH = Math.min(totalDeltaY * 0.5, ROW_HEIGHT * 3);

  if (totalDeltaY <= ROW_HEIGHT * 0.5) {
    // Very short span – just draw a straight diagonal
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  if (toX > fromX) {
    // Branching out (rightward): diagonal starts at the top (near source)
    const diagEndY = fromY + diagonalH;
    return `M ${fromX} ${fromY} L ${toX} ${diagEndY} L ${toX} ${toY}`;
  }
  // Merging in (leftward): diagonal ends at the bottom (near target)
  const diagStartY = toY - diagonalH;
  return `M ${fromX} ${fromY} L ${fromX} ${diagStartY} L ${toX} ${toY}`;
}

function routedLinePath(
  points: Array<{ x: number; y: number }>,
  isStub?: boolean,
): string {
  if (points.length < 2) {
    return "";
  }
  if (isStub || points.length === 2) {
    return linePath(points[0].x, points[0].y, points[1].x, points[1].y, isStub);
  }

  const compact: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const prev = compact[compact.length - 1];
    if (!prev || prev.x !== point.x || prev.y !== point.y) {
      compact.push(point);
    }
  }

  return compact
    .map((point, index) =>
      index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`,
    )
    .join(" ");
}

function routeKey(fromHash: string, targetHash: string): string {
  return `${fromHash}\x00${targetHash}`;
}

/**
 * Walk the graph layout's parent chain from `hash` until we find a commit
 * that exists in the visible set, skipping hidden (filtered-out) commits.
 */
function resolveVisibleTarget(
  hash: string,
  visibleSet: Set<string>,
  layout: Record<string, LaneInfo>,
): string | null {
  let current = hash;
  const visited = new Set<string>();
  while (current && !visibleSet.has(current)) {
    if (visited.has(current)) return null;
    visited.add(current);
    const lane = layout[current];
    if (!lane || lane.lines.length === 0) return null;
    current = lane.lines[0].toCommit;
  }
  return visibleSet.has(current) ? current : null;
}

// ── Sequence detection (O(n)) ──────────────────────────────────────

interface SequenceResult {
  sequences: CollapsibleSequence[];
  hashToSequenceId: Record<string, string>;
  sequencesById: Record<string, CollapsibleSequence>;
}

function computeCollapsibleSequences(
  commits: Commit[],
  graphLayout: Record<string, LaneInfo>,
): SequenceResult {
  const empty: SequenceResult = {
    sequences: [],
    hashToSequenceId: {},
    sequencesById: {},
  };
  if (commits.length === 0) return empty;

  const commitByHash: Record<string, Commit> = {};
  for (const c of commits) {
    commitByHash[c.hash] = c;
  }

  // Build childCount and single-child map from currently loaded commits.
  const childCount: Record<string, number> = {};
  const onlyChildByParent: Record<string, string | undefined> = {};
  for (const c of commits) {
    for (const p of c.parents) {
      if (!commitByHash[p]) continue;
      childCount[p] = (childCount[p] || 0) + 1;
      if (!onlyChildByParent[p]) {
        onlyChildByParent[p] = c.hash;
      } else {
        onlyChildByParent[p] = undefined;
      }
    }
  }

  // A commit can be an intermediate node only if it is linear and remains
  // in the same visible lane with its parent/child.
  const isIntermediate = (c: Commit): boolean => {
    if (c.parents.length !== 1) return false;
    if ((childCount[c.hash] ?? 0) !== 1) return false;
    if (c.refs.length > 0) return false;

    const parent = commitByHash[c.parents[0]];
    const childHash = onlyChildByParent[c.hash];
    const child = childHash ? commitByHash[childHash] : undefined;
    if (!parent || !child) return false;

    const lane = graphLayout[c.hash];
    const parentLane = graphLayout[parent.hash];
    const childLane = graphLayout[child.hash];
    if (!lane || !parentLane || !childLane) return false;

    if (lane.column !== parentLane.column || lane.column !== childLane.column) {
      return false;
    }
    if (lane.color !== parentLane.color || lane.color !== childLane.color) {
      return false;
    }
    return true;
  };

  // Walk topology-connected linear chains.
  const sequences: CollapsibleSequence[] = [];
  const hashToSequenceId: Record<string, string> = {};
  const sequencesById: Record<string, CollapsibleSequence> = {};
  const visited = new Set<string>();

  for (const seed of commits) {
    if (visited.has(seed.hash) || !isIntermediate(seed)) continue;

    // Move upward to the topmost intermediate in this chain.
    let top = seed;
    while (true) {
      const childHash = onlyChildByParent[top.hash];
      const child = childHash ? commitByHash[childHash] : undefined;
      if (!child || !isIntermediate(child)) break;
      if (child.parents[0] !== top.hash) break;
      top = child;
    }

    // Walk down from top through intermediate parents.
    const intermediates: string[] = [];
    let current = top;
    while (isIntermediate(current) && !visited.has(current.hash)) {
      intermediates.push(current.hash);
      visited.add(current.hash);
      const parentHash = current.parents[0];
      const parent = commitByHash[parentHash];
      if (!parent || !isIntermediate(parent)) break;
      if (onlyChildByParent[parent.hash] !== current.hash) break;
      current = parent;
    }

    if (intermediates.length < 2) continue;

    const headHash = onlyChildByParent[top.hash];
    const tailHash = current.parents[0];
    if (!headHash || !tailHash) continue;
    if (!commitByHash[headHash] || !commitByHash[tailHash]) continue;

    const lane = graphLayout[top.hash];
    if (!lane) continue;

    const id = `seq-${headHash}-${tailHash}`;
    const seq: CollapsibleSequence = {
      id,
      headHash,
      tailHash,
      intermediates,
      column: lane.column,
      color: lane.color,
    };
    sequences.push(seq);
    sequencesById[id] = seq;
    for (const h of intermediates) {
      hashToSequenceId[h] = id;
    }
  }

  return { sequences, hashToSequenceId, sequencesById };
}

// ── Component ──────────────────────────────────────────────────────

export function GitGraphSvg({
  scrollTop,
  height,
  topOffset = 0,
}: {
  scrollTop: number;
  height: number;
  topOffset?: number;
}) {
  const visibleCommits = usePanelStore((s) => s.visibleCommits);
  const commits = usePanelStore((s) => s.commits);
  const graphLayout = usePanelStore((s) => s.graphLayout);
  const collapsedSequenceIds = usePanelStore((s) => s.collapsedSequenceIds);

  const [hoveredSequenceId, setHoveredSequenceId] = useState<string | null>(
    null,
  );

  // Sequence detection on full commits list
  const { hashToSequenceId, sequencesById } = useMemo(
    () => computeCollapsibleSequences(commits, graphLayout),
    [commits, graphLayout],
  );

  const { rowIndexByHash, visibleSet } = useMemo(() => {
    const indexMap: Record<string, number> = {};
    const set = new Set<string>();
    for (let i = 0; i < visibleCommits.length; i++) {
      indexMap[visibleCommits[i].hash] = i;
      set.add(visibleCommits[i].hash);
    }
    return { rowIndexByHash: indexMap, visibleSet: set };
  }, [visibleCommits]);

  const incomingFanColumns = useMemo(() => {
    const result: Record<string, number> = {};
    const incoming: Record<
      string,
      Array<{
        sourceHash: string;
        sourceRow: number;
        sourceColumn: number;
        attachColumn: number;
      }>
    > = {};

    for (let i = 0; i < visibleCommits.length; i++) {
      const commit = visibleCommits[i];
      const lane = graphLayout[commit.hash];
      if (!lane) continue;

      for (const line of lane.lines) {
        const targetRow = rowIndexByHash[line.toCommit];
        if (targetRow == null || line.hiddenParent) continue;

        const lastRouteColumn =
          line.route && line.route.length > 0
            ? line.route[line.route.length - 1].column
            : line.fromColumn;
        const attachColumn = Math.max(
          lastRouteColumn,
          line.fromColumn,
          line.toColumn,
        );

        const list = incoming[line.toCommit] ?? [];
        list.push({
          sourceHash: commit.hash,
          sourceRow: i,
          sourceColumn: lane.column,
          attachColumn,
        });
        incoming[line.toCommit] = list;
      }
    }

    for (const [targetHash, edges] of Object.entries(incoming)) {
      const targetColumn = graphLayout[targetHash]?.column ?? 0;
      edges.sort(
        (a, b) =>
          a.attachColumn - b.attachColumn ||
          a.sourceColumn - b.sourceColumn ||
          b.sourceRow - a.sourceRow,
      );

      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const direction = edge.attachColumn < targetColumn ? -1 : 1;
        const fanColumn =
          i === 0
            ? targetColumn
            : direction > 0
              ? Math.max(edge.attachColumn, targetColumn + i)
              : Math.min(edge.attachColumn, targetColumn - i);
        result[routeKey(edge.sourceHash, targetHash)] = fanColumn;
      }
    }

    return result;
  }, [visibleCommits, graphLayout, rowIndexByHash]);

  const maxColumn = Math.max(
    0,
    ...Object.values(graphLayout).flatMap((lane) => [
      lane.column,
      ...lane.lines.flatMap((line) => [
        line.fromColumn,
        line.toColumn,
        ...(line.route?.map((point) => point.column) ?? []),
      ]),
    ]),
    ...Object.values(incomingFanColumns),
  );
  const svgWidth = (maxColumn + 1) * COLUMN_WIDTH + GRAPH_PADDING * 2;

  const { allLines, allNodes } = useMemo(() => {
    const lines: Array<{
      key: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      minY: number;
      maxY: number;
      color: string;
      isStub?: boolean;
      isDashed?: boolean;
      fromHash?: string;
      targetHash?: string;
      sequenceId?: string;
      points: Array<{ x: number; y: number }>;
    }> = [];
    const nodes: Array<{
      key: string;
      cx: number;
      cy: number;
      color: string;
      isMerge: boolean;
      isHead: boolean;
    }> = [];

    if (!visibleCommits.length) {
      return { allLines: lines, allNodes: nodes };
    }

    for (let i = 0; i < visibleCommits.length; i++) {
      const commit = visibleCommits[i];
      const lane = graphLayout[commit.hash];
      if (!lane) continue;

      const fromX = colX(lane.column);
      const fromY = rowY(i);
      const color = laneColor(lane.color);

      nodes.push({
        key: commit.hash,
        cx: fromX,
        cy: fromY,
        color,
        isMerge: commit.parents.length > 1,
        isHead: commit.refs.some((r) => r.type === "HEAD"),
      });

      for (const line of lane.lines) {
        const lineFromX = colX(line.fromColumn);
        const lineColor =
          line.phantom && line.phantomColor !== undefined
            ? laneColor(line.phantomColor)
            : color;

        let targetHash = line.toCommit;
        let targetIdx = rowIndexByHash[targetHash];
        const isStraight = line.phantom
          ? line.fromColumn === line.toColumn
          : lane.column === line.toColumn;
        let isStub = false;
        let wasResolved = false;

        if (targetIdx == null) {
          if (isStraight) {
            const resolved = resolveVisibleTarget(
              targetHash,
              visibleSet,
              graphLayout,
            );
            if (!resolved) {
              // Target not in visible set at all — draw a stub downward
              isStub = true;
            } else {
              if (resolved !== targetHash) wasResolved = true;
              targetHash = resolved;
              targetIdx = rowIndexByHash[targetHash];
              if (targetIdx == null) {
                isStub = true;
              }
            }
          } else {
            isStub = true;
          }
        }

        const targetLane = graphLayout[targetHash];
        let toX: number;
        if (targetLane) {
          toX = colX(targetLane.column);
        } else if (line.hiddenParent) {
          const origTargetLane = graphLayout[line.toCommit];
          toX = origTargetLane
            ? colX(origTargetLane.column)
            : colX(line.toColumn);
        } else {
          toX = colX(line.toColumn);
        }

        let toY: number;
        let isDashed = false;

        if (isStub) {
          toY = fromY + ROW_HEIGHT;
          if (!isStraight) {
            const dx = toX - lineFromX;
            toX =
              lineFromX +
              Math.sign(dx) * Math.min(Math.abs(dx), COLUMN_WIDTH * 0.5);
          } else {
            toX = lineFromX;
          }
          isDashed = false;
        } else {
          toY = rowY(targetIdx as number);
          if (wasResolved) {
            isDashed = true;
          }
        }

        const points = [{ x: lineFromX, y: fromY }];
        if (!isStub && !wasResolved && line.route) {
          for (const point of line.route) {
            const routeIdx = rowIndexByHash[point.commit];
            if (routeIdx == null) {
              continue;
            }
            const routeY = rowY(routeIdx);
            if (routeY <= fromY || routeY >= toY) {
              continue;
            }
            points.push({ x: colX(point.column), y: routeY });
          }
        }
        if (!isStub && !wasResolved && targetIdx != null) {
          const fanColumn =
            incomingFanColumns[routeKey(commit.hash, targetHash)];
          if (fanColumn != null && fanColumn !== line.toColumn) {
            points.push({
              x: colX(fanColumn),
              y: toY - ROW_HEIGHT * 0.55,
            });
          }
        }
        points.push({ x: toX, y: toY });

        // Determine sequenceId for this line
        let lineSeqId: string | undefined;
        // If fromHash is in a sequence → this line belongs to that sequence
        const fromSeq = hashToSequenceId[commit.hash];
        if (fromSeq) {
          lineSeqId = fromSeq;
        } else {
          // If fromHash is the headHash of a sequence and target is the first intermediate
          const origTarget = line.toCommit;
          const targetSeq = hashToSequenceId[origTarget];
          if (targetSeq && isStraight) {
            const seq = sequencesById[targetSeq];
            if (seq && seq.headHash === commit.hash) {
              lineSeqId = targetSeq;
            }
          }
        }
        lines.push({
          key: `${commit.hash}-${targetHash}-${line.phantom ? "ph" : lane.column}-${line.toColumn}`,
          fromX: lineFromX,
          fromY,
          toX,
          toY,
          minY: Math.min(fromY, toY),
          maxY: Math.max(fromY, toY),
          color: lineColor,
          isStub,
          isDashed,
          fromHash: commit.hash,
          targetHash: line.toCommit,
          sequenceId: lineSeqId,
          points,
        });
      }
    }

    return { allLines: lines, allNodes: nodes };
  }, [
    visibleCommits,
    graphLayout,
    rowIndexByHash,
    visibleSet,
    incomingFanColumns,
    hashToSequenceId,
    sequencesById,
  ]);

  const { visibleLines, visibleNodes } = useMemo(() => {
    const overscanPx = VISIBLE_OVERSCAN * ROW_HEIGHT;
    const viewportTop = scrollTop - overscanPx;
    const viewportBottom = scrollTop + height + overscanPx;

    const lines = allLines
      .filter((line) => line.maxY >= viewportTop && line.minY <= viewportBottom)
      .map((line) => ({
        key: line.key,
        d: routedLinePath(line.points, line.isStub),
        color: line.color,
        isStub: line.isStub,
        isDashed: line.isDashed,
        fromHash: line.fromHash,
        targetHash: line.targetHash,
        sequenceId: line.sequenceId,
        toX: line.toX,
        toY: line.toY,
      }));

    const nodes = allNodes.filter(
      (node) => node.cy >= viewportTop && node.cy <= viewportBottom,
    );

    return { visibleLines: lines, visibleNodes: nodes };
  }, [allLines, allNodes, height, scrollTop]);

  return (
    <svg
      width={svgWidth}
      height={height}
      viewBox={`0 0 ${svgWidth} ${height}`}
      style={{
        position: "absolute",
        top: topOffset,
        left: 0,
        pointerEvents: "none",
        zIndex: 2,
      }}
      aria-hidden="true"
    >
      <g transform={`translate(0, ${-scrollTop})`}>
        {visibleLines.map((line) => {
          const hasSeq = !!line.sequenceId;
          const isSeqHovered = hasSeq && line.sequenceId === hoveredSequenceId;
          const isSeqCollapsed =
            hasSeq && collapsedSequenceIds.has(line.sequenceId as string);

          let className = "graph-line-group";
          if (hasSeq) {
            className += " graph-sequence-line interactive";
            if (isSeqHovered) className += " sequence-hover";
            if (isSeqCollapsed) className += " sequence-collapsed";
          }

          return (
            <g
              key={line.key}
              className={className}
              style={{
                cursor: hasSeq ? "pointer" : "default",
                pointerEvents: hasSeq ? "auto" : "none",
              }}
              onMouseEnter={() => {
                if (hasSeq) setHoveredSequenceId(line.sequenceId as string);
              }}
              onMouseLeave={() => {
                if (hasSeq) setHoveredSequenceId(null);
              }}
              onClick={() => {
                if (line.sequenceId) {
                  const seq = sequencesById[line.sequenceId];
                  if (seq) {
                    usePanelStore
                      .getState()
                      .toggleSequenceCollapse(seq.id, seq.intermediates);
                  }
                }
              }}
            >
              <path
                className="graph-line-path"
                d={line.d}
                fill="none"
                stroke={line.color}
                strokeWidth={1.2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={
                  line.isDashed && !line.isStub ? "4,2" : undefined
                }
                opacity={1}
              />
              {line.isStub && (
                <polygon
                  points={`${line.toX - 2.5},${line.toY - 4} ${line.toX},${line.toY} ${line.toX + 2.5},${line.toY - 4}`}
                  fill={line.color}
                />
              )}
              <path
                className="graph-line-hitbox"
                d={line.d}
                fill="none"
                stroke="transparent"
                strokeWidth={hasSeq ? 12 : 0}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {visibleNodes.map((node) => (
          <g key={node.key}>
            {node.isMerge ? (
              <>
                <circle cx={node.cx} cy={node.cy} r={3.5} fill={node.color} />
                <circle
                  cx={node.cx}
                  cy={node.cy}
                  r={2}
                  fill="var(--app-bg, #1e1e1e)"
                />
                <circle cx={node.cx} cy={node.cy} r={1.2} fill={node.color} />
              </>
            ) : (
              <circle cx={node.cx} cy={node.cy} r={2.8} fill={node.color} />
            )}

            {node.isHead && (
              <circle
                cx={node.cx}
                cy={node.cy}
                r={5}
                fill="none"
                stroke={node.color}
                strokeWidth={1}
                opacity={0.22}
              />
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}
