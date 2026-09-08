"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ReviewGraphDay {
  readonly date: string;
  readonly chars: number;
  readonly excerpt: string;
  readonly keywords: readonly string[];
}

interface GraphNode {
  readonly id: string;
  readonly kind: "day" | "keyword";
  readonly date?: string;
  readonly word?: string;
  readonly excerpt: string;
  weight: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

interface GraphEdge {
  readonly source: number;
  readonly target: number;
  readonly length: number;
  readonly strength: number;
}

const WIDTH = 960;
const HEIGHT = 560;
const DAY_BASE_RADIUS = 7;
const DAY_MAX_RADIUS = 18;
const KEYWORD_MAX_RADIUS = 11;

function buildGraph(days: readonly ReviewGraphDay[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIndex = new Map<string, number>();

  function addNode(node: GraphNode): number {
    const index = nodes.length;
    nodes.push(node);
    nodeIndex.set(node.id, index);
    return index;
  }

  const maxChars = Math.max(1, ...days.map((day) => day.chars));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  days.forEach((day, index) => {
    // 初始位置：黄金角螺旋，保证确定性的铺开起点。
    const radius = 42 + Math.sqrt(index + 1) * 26;
    const angle = index * goldenAngle;
    addNode({
      id: `day:${day.date}`,
      kind: "day",
      date: day.date,
      weight: DAY_BASE_RADIUS + (DAY_MAX_RADIUS - DAY_BASE_RADIUS) * Math.sqrt(day.chars / maxChars),
      excerpt: day.excerpt,
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      fixed: false,
    });
  });
  days.forEach((day, index) => {
    if (index > 0) {
      edges.push({ source: index - 1, target: index, length: 64, strength: 0.035 });
    }
    for (const word of day.keywords) {
      const keywordId = `word:${word}`;
      let keywordIndex = nodeIndex.get(keywordId);
      if (keywordIndex === undefined) {
        keywordIndex = addNode({
          id: keywordId,
          kind: "keyword",
          word,
          weight: 4,
          excerpt: "",
          x: WIDTH / 2 + (Math.random() - 0.5) * 40,
          y: HEIGHT / 2 + (Math.random() - 0.5) * 40,
          vx: 0,
          vy: 0,
          fixed: false,
        });
      }
      const keyword = nodes[keywordIndex];
      keyword.weight = Math.min(KEYWORD_MAX_RADIUS, keyword.weight + 0.8);
      edges.push({ source: index, target: keywordIndex, length: 96, strength: 0.02 });
    }
  });
  return { nodes, edges };
}

function runSimulation(nodes: GraphNode[], edges: readonly GraphEdge[], ticks: number): void {
  let alpha = 0.9;
  for (let tick = 0; tick < ticks; tick += 1) {
    // 库仑斥力（O(n²)，节点规模 ≤ 200，可接受）
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distance = 1;
        }
        const force = (9000 * alpha) / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    // 弹簧引力
    for (const edge of edges) {
      const a = nodes[edge.source];
      const b = nodes[edge.target];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = (distance - edge.length) * edge.strength * alpha * 6;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // 向心力 + 积分
    for (const node of nodes) {
      node.vx += (WIDTH / 2 - node.x) * 0.0035 * alpha;
      node.vy += (HEIGHT / 2 - node.y) * 0.005 * alpha;
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x += Math.max(-24, Math.min(24, node.vx));
      node.y += Math.max(-24, Math.min(24, node.vy));
      node.x = Math.max(30, Math.min(WIDTH - 30, node.x));
      node.y = Math.max(26, Math.min(HEIGHT - 26, node.y));
    }
    alpha = Math.max(0.05, alpha * 0.985);
  }
}

export function ReviewGraph({ days }: { days: readonly ReviewGraphDay[] }) {
  const [layout, setLayout] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; excerpt: string } | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layoutRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);

  const graph = useMemo(() => buildGraph(days), [days]);

  useEffect(() => {
    const nodes = graph.nodes.map((node) => ({ ...node }));
    const edges = graph.edges;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      runSimulation(nodes, edges, 320);
      layoutRef.current = { nodes, edges };
      setLayout({ nodes, edges });
      return;
    }
    // 动画模式：分帧演化，落定后停止重渲染。
    let frame = 0;
    let raf = 0;
    const step = () => {
      runSimulation(nodes, edges, 3);
      frame += 3;
      layoutRef.current = { nodes, edges };
      setLayout({ nodes, edges });
      if (frame < 300) {
        raf = window.requestAnimationFrame(step);
      }
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [graph]);

  useEffect(() => {
    if (dragged === null) return;
    function onMove(event: PointerEvent) {
      const current = layoutRef.current;
      if (!current || dragged === null) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
      dragMovedRef.current = true;
      const node = current.nodes[dragged];
      node.x = Math.max(30, Math.min(WIDTH - 30, x + dragOffsetRef.current.x));
      node.y = Math.max(26, Math.min(HEIGHT - 26, y + dragOffsetRef.current.y));
      node.vx = 0;
      node.vy = 0;
      node.fixed = true;
      setLayout({ nodes: current.nodes, edges: current.edges });
    }
    function onUp() {
      const current = layoutRef.current;
      if (current && dragged !== null) current.nodes[dragged].fixed = false;
      setDragged(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragged]);

  if (!layout) {
    return (
      <div aria-busy="true" className="review-graph-shell">
        <p className="review-graph-loading">正在铺开复盘星图…</p>
      </div>
    );
  }

  function svgPoint(event: React.PointerEvent<SVGGElement>): { x: number; y: number } {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  return (
    <div className="review-graph-shell">
      <svg
        aria-label="复盘星图：绿色节点是写过复盘的一天，琥珀色节点是反复出现的关键词；点击日期节点可打开当天复盘"
        ref={svgRef}
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {layout.edges.map((edge, index) => {
          const a = layout.nodes[edge.source];
          const b = layout.nodes[edge.target];
          const isChain = a.kind === "day" && b.kind === "day";
          return (
            <line
              className={isChain ? "review-graph-edge is-chain" : "review-graph-edge"}
              key={`${edge.source}-${edge.target}-${index}`}
              stroke={isChain ? "rgba(36, 73, 60, 0.3)" : "rgba(199, 156, 87, 0.36)"}
              x1={a.x}
              x2={b.x}
              y1={a.y}
              y2={b.y}
            />
          );
        })}
        {layout.nodes.map((node, index) => {
          if (node.kind === "keyword") {
            return (
              <g key={node.id}>
                <circle
                  className="review-graph-keyword"
                  cx={node.x}
                  cy={node.y}
                  r={4 + node.weight}
                  fill="rgba(199, 156, 87, 0.85)"
                  stroke="rgba(255, 255, 255, 0.8)"
                  strokeWidth={1}
                  onPointerDown={(event) => {
                    const point = svgPoint(event);
                    dragOffsetRef.current = { x: node.x - point.x, y: node.y - point.y };
                    dragMovedRef.current = false;
                    setDragged(index);
                  }}
                />
                <text
                  className="review-graph-keyword-label"
                  textAnchor="middle"
                  x={node.x}
                  y={node.y - node.weight - 6}
                >
                  {node.word}
                </text>
              </g>
            );
          }
          const [year, month, day] = (node.date ?? "").split("-");
          return (
            <a
              href={`/daily-review?date=${node.date}`}
              key={node.id}
              onClick={(event) => {
                if (dragMovedRef.current) event.preventDefault();
              }}
            >
              <g
                className="review-graph-day"
                onPointerDown={(event) => {
                  const point = svgPoint(event);
                  dragOffsetRef.current = { x: node.x - point.x, y: node.y - point.y };
                  dragMovedRef.current = false;
                  setDragged(index);
                }}
                onPointerEnter={() => setHover({
                  x: node.x,
                  y: node.y,
                  label: `${Number(month)}月${Number(day)}日`,
                  excerpt: node.excerpt,
                })}
                onPointerLeave={() => setHover(null)}
              >
                <circle
                  className="review-graph-day-circle"
                  cx={node.x}
                  cy={node.y}
                  r={node.weight}
                />
                <text
                  className="review-graph-day-label"
                  textAnchor="middle"
                  x={node.x}
                  y={node.y + node.weight + 13}
                >
                  {Number(month)}/{Number(day)}
                </text>
              </g>
            </a>
          );
        })}
      </svg>
      {hover ? (
        <div
          className="review-graph-tooltip"
          style={{
            left: `${(hover.x / WIDTH) * 100}%`,
            top: `${(hover.y / HEIGHT) * 100}%`,
          }}
        >
          <strong>{hover.label}</strong>
          {hover.excerpt ? <p>{hover.excerpt}</p> : <p>这一天还没有写下内容</p>}
        </div>
      ) : null}
    </div>
  );
}
