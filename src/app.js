'use strict';

/* ================================================================
   SECTION 1 — UTILITIES
   ================================================================ */

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ================================================================
   SECTION 2 — GRAPH MODEL
   ================================================================ */

class GraphModel {
  constructor() {
    this.nodes = new Map();  // id -> NodeData
    this.edges = new Map();  // id -> EdgeData
    this.startNodeId = null;
  }

  addNode(label, h, isGoal, x, y) {
    const id = uid();
    const node = { id, label: String(label).trim(), h: parseFloat(h) || 0, isGoal: !!isGoal, x: x || 300, y: y || 300 };
    this.nodes.set(id, node);
    return node;
  }

  updateNode(id, updates) {
    const n = this.nodes.get(id);
    if (n) Object.assign(n, updates);
    return n;
  }

  removeNode(id) {
    this.nodes.delete(id);
    for (const [eid, e] of this.edges) {
      if (e.source === id || e.target === id) this.edges.delete(eid);
    }
    if (this.startNodeId === id) this.startNodeId = null;
  }

  addEdge(sourceId, targetId, weight) {
    for (const e of this.edges.values()) {
      if (e.source === sourceId && e.target === targetId) return null;
    }
    const id = uid();
    const edge = { id, source: sourceId, target: targetId, weight: parseFloat(weight) || 1 };
    this.edges.set(id, edge);
    return edge;
  }

  updateEdge(id, updates) {
    const e = this.edges.get(id);
    if (e) Object.assign(e, updates);
    return e;
  }

  removeEdge(id) { this.edges.delete(id); }

  getNeighbors(nodeId) {
    const out = [];
    for (const e of this.edges.values()) {
      if (e.source === nodeId) {
        const t = this.nodes.get(e.target);
        if (t) out.push({ node: t, edge: e });
      }
    }
    return out;
  }

  clear() { this.nodes.clear(); this.edges.clear(); this.startNodeId = null; }
}

/* ================================================================
   SECTION 3 — SEARCH TREE HELPERS
   ================================================================ */

function makeTreeNode(graphNode, parent, edgeWeight) {
  const g = (parent ? parent.g : 0) + (edgeWeight || 0);
  return {
    treeId: uid(),
    graphNodeId: graphNode.id,
    label: graphNode.label,
    parent: parent || null,
    children: [],
    depth: parent ? parent.depth + 1 : 0,
    g,
    h: graphNode.h,
    f: g + graphNode.h,
    pathEdgeWeight: edgeWeight || 0,
    isGoal: graphNode.isGoal,
    state: 'in-queue'   // 'in-queue' | 'current' | 'expanded' | 'goal' | 'pruned'
  };
}

function cloneTree(node, parentClone) {
  if (!node) return null;
  const c = Object.assign({}, node, { parent: parentClone || null, children: [] });
  c.children = node.children.map(ch => cloneTree(ch, c));
  return c;
}

function getPathToRoot(tn) {
  const path = [];
  let n = tn;
  while (n) { path.unshift(n); n = n.parent; }
  return path;
}

function findInTree(root, treeId) {
  if (!root) return null;
  if (root.treeId === treeId) return root;
  for (const ch of root.children) {
    const f = findInTree(ch, treeId);
    if (f) return f;
  }
  return null;
}

/* ================================================================
   SECTION 4 — MIN-HEAP (priority queue)
   ================================================================ */

class MinHeap {
  constructor(keyFn) { this.data = []; this.keyFn = keyFn; }
  get size() { return this.data.length; }
  peek() { return this.data[0] || null; }

  push(item) {
    this.data.push(item);
    this._up(this.data.length - 1);
  }

  pop() {
    if (!this.data.length) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length) { this.data[0] = last; this._down(0); }
    return top;
  }

  toSorted() {
    return [...this.data].sort((a, b) => this._cmp(a, b));
  }

  _cmp(a, b) {
    const d = this.keyFn(a) - this.keyFn(b);
    if (d !== 0) return d;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  }

  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._cmp(this.data[p], this.data[i]) <= 0) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }

  _down(i) {
    const n = this.data.length;
    while (true) {
      let s = i, l = 2*i+1, r = 2*i+2;
      if (l < n && this._cmp(this.data[l], this.data[s]) < 0) s = l;
      if (r < n && this._cmp(this.data[r], this.data[s]) < 0) s = r;
      if (s === i) break;
      [this.data[s], this.data[i]] = [this.data[i], this.data[s]];
      i = s;
    }
  }
}

/* ================================================================
   SECTION 5 — ALGORITHM RUNNER (step recorder)
   ================================================================ */

class Runner {
  constructor(graph) {
    this.graph   = graph;
    this.steps   = [];
    this.closed  = new Set();
    this.closedList = [];
  }

  snap(eventType, description, treeRoot, openEntries, currentTreeId, solutionIds) {
    this.steps.push({
      stepIndex:        this.steps.length,
      eventType,
      description,
      treeRoot:         treeRoot ? cloneTree(treeRoot, null) : null,
      openQueue:        (openEntries || []).map((e, i) => ({ ...e, isNext: i === 0 })),
      closedList:       [...this.closedList],
      currentTreeNodeId: currentTreeId || null,
      solutionPath:     solutionIds  || null
    });
  }
}

/* helper to build an open-queue entry from a tree node */
function qe(tn, algo) {
  return { treeNodeId: tn.treeId, graphNodeId: tn.graphNodeId, label: tn.label,
           g: tn.g, h: tn.h, f: tn.f, depth: tn.depth, algo };
}

/* ================================================================
   SECTION 6 — ALGORITHMS
   ================================================================ */

/* ── BFS ─────────────────────────────────────────────────────── */
function runBFS(graph) {
  const r = new Runner(graph);
  const start = graph.nodes.get(graph.startNodeId);
  if (!start) return [];

  const inOpen = new Set();
  const queue  = [];
  const root   = makeTreeNode(start, null, 0);

  r.snap('init', 'Initialize: frontier is empty.', root, [], null, null);

  // Early goal test on start node
  if (start.isGoal) {
    root.state = 'goal';
    r.snap('goal-found', `Start "${start.label}" is already a goal! Path: ${start.label}`,
      root, [], root.treeId, [root.treeId]);
    return r.steps;
  }

  root.state = 'in-queue';
  inOpen.add(start.id);
  queue.push(root);
  r.snap('push-open', `Push start "${start.label}" to frontier (depth 0).`,
    root, queue.map(t => qe(t, 'bfs')), root.treeId, null);

  while (queue.length) {
    const tn = queue.shift();
    if (r.closed.has(tn.graphNodeId)) continue;

    tn.state = 'current';
    r.snap('pop-open', `Pop "${tn.label}" from frontier (depth=${tn.depth}).`,
      root, queue.map(t => qe(t, 'bfs')), tn.treeId, null);

    r.closed.add(tn.graphNodeId);
    r.closedList.push(tn.graphNodeId);
    tn.state = 'expanded';

    const candidates = graph.getNeighbors(tn.graphNodeId)
      .filter(({ node: nb }) => !r.closed.has(nb.id) && !inOpen.has(nb.id))
      .sort((a, b) => a.node.label < b.node.label ? -1 : a.node.label > b.node.label ? 1 : 0);

    // Process children alphabetically: add all to frontier up to (and including) the first goal
    let firstGoal = null;
    for (const { node: nb, edge } of candidates) {
      const child = makeTreeNode(nb, tn, edge.weight);
      tn.children.push(child);
      if (nb.isGoal) {
        child.state = 'goal';
        firstGoal   = child;
        break;           // siblings after the goal are not shown
      }
      child.state = 'in-queue';
      queue.push(child);
      inOpen.add(nb.id);
    }

    if (firstGoal) {
      const path = getPathToRoot(firstGoal);
      r.snap('goal-found',
        `Expand "${tn.label}" → Goal "${firstGoal.label}" discovered at depth ${firstGoal.depth}! Path: ${path.map(n => n.label).join(' → ')}`,
        root, queue.map(t => qe(t, 'bfs')), firstGoal.treeId, path.map(n => n.treeId));
      return r.steps;
    }

    r.snap('expand',
      `Expand "${tn.label}" → ${candidates.length} child(ren) added to frontier.`,
      root, queue.map(t => qe(t, 'bfs')), tn.treeId, null);
  }

  r.snap('no-solution', 'Frontier empty — no solution found.', root, [], null, null);
  return r.steps;
}

/* ── DFS ─────────────────────────────────────────────────────── */
function runDFS(graph) {
  const r = new Runner(graph);
  const start = graph.nodes.get(graph.startNodeId);
  if (!start) return [];

  const root = makeTreeNode(start, null, 0);
  r.snap('init', 'Initialize: stack is empty.', root, [], null, null);

  // Early goal test on start node
  if (start.isGoal) {
    root.state = 'goal';
    r.snap('goal-found', `Start "${start.label}" is already a goal! Path: ${start.label}`,
      root, [], root.treeId, [root.treeId]);
    return r.steps;
  }

  root.state = 'in-queue';
  const stack = [root];
  r.snap('push-open', `Push start "${start.label}" onto stack (depth 0).`,
    root, stack.map(t => qe(t, 'dfs')), root.treeId, null);

  while (stack.length) {
    const tn = stack.pop();
    tn.state = 'current';
    r.snap('pop-open', `Pop "${tn.label}" from stack (depth=${tn.depth}).`,
      root, stack.map(t => qe(t, 'dfs')), tn.treeId, null);

    tn.state = 'expanded';
    r.closedList.push(tn.graphNodeId);

    // Path-based cycle check: only skip nodes already on the path from root to tn
    // (no global visited set — matches the recursive pseudocode)
    const ancestorIds = new Set();
    let anc = tn.parent;
    while (anc) { ancestorIds.add(anc.graphNodeId); anc = anc.parent; }

    const candidates = graph.getNeighbors(tn.graphNodeId)
      .filter(({ node: nb }) => !ancestorIds.has(nb.id))
      .sort((a, b) => a.node.label < b.node.label ? -1 : a.node.label > b.node.label ? 1 : 0);

    let firstGoal = null;
    const toStack = [];
    for (const { node: nb, edge } of candidates) {
      const child = makeTreeNode(nb, tn, edge.weight);
      tn.children.push(child);
      if (nb.isGoal) {
        child.state = 'goal';
        firstGoal   = child;
        break;
      }
      child.state = 'in-queue';
      toStack.push(child);
    }

    if (firstGoal) {
      for (let i = toStack.length - 1; i >= 0; i--) stack.push(toStack[i]);
      const path = getPathToRoot(firstGoal);
      r.snap('goal-found',
        `Expand "${tn.label}" → Goal "${firstGoal.label}" discovered at depth ${firstGoal.depth}! Path: ${path.map(n => n.label).join(' → ')}`,
        root, stack.map(t => qe(t, 'dfs')), firstGoal.treeId, path.map(n => n.treeId));
      return r.steps;
    }

    for (let i = toStack.length - 1; i >= 0; i--) stack.push(toStack[i]);
    r.snap('expand',
      `Expand "${tn.label}" → ${candidates.length} child(ren) pushed onto stack.`,
      root, stack.map(t => qe(t, 'dfs')), tn.treeId, null);
  }

  r.snap('no-solution', 'Stack empty — no solution found.', root, [], null, null);
  return r.steps;
}

/* ── DFS with depth limit (tree search, ancestor-cycle check) ── */
function runDFSLimited(graph, limit) {
  const r = new Runner(graph);
  const start = graph.nodes.get(graph.startNodeId);
  if (!start) return [];

  const root = makeTreeNode(start, null, 0);

  r.snap('init', `DFS with depth limit = ${limit}.`, root, [], null, null);

  // Early goal test on start node
  if (start.isGoal) {
    root.state = 'goal';
    r.snap('goal-found', `Start "${start.label}" is already a goal! Path: ${start.label}`,
      root, [], root.treeId, [root.treeId]);
    return r.steps;
  }

  root.state = 'in-queue';
  const stack = [root];

  while (stack.length) {
    const tn = stack.pop();
    tn.state = 'current';
    r.snap('pop-open', `Pop "${tn.label}" (depth=${tn.depth}).`,
      root, stack.map(t => qe(t, 'dfs-limited')), tn.treeId, null);

    if (tn.depth >= limit) {
      tn.state = 'pruned';
      r.snap('prune', `"${tn.label}" at depth limit (${limit}) — not expanded.`,
        root, stack.map(t => qe(t, 'dfs-limited')), tn.treeId, null);
      continue;
    }

    tn.state = 'expanded';
    r.closedList.push(tn.graphNodeId);

    const ancestorIds = new Set();
    let anc = tn.parent;
    while (anc) { ancestorIds.add(anc.graphNodeId); anc = anc.parent; }

    const candidates = graph.getNeighbors(tn.graphNodeId)
      .filter(({ node }) => !ancestorIds.has(node.id))
      .sort((a, b) => a.node.label < b.node.label ? -1 : a.node.label > b.node.label ? 1 : 0);

    // Process children alphabetically up to (and including) the first goal
    let firstGoal = null;
    const toStack = [];
    for (const { node: nb, edge } of candidates) {
      const child = makeTreeNode(nb, tn, edge.weight);
      tn.children.push(child);
      if (nb.isGoal) {
        child.state = 'goal';
        firstGoal   = child;
        break;
      }
      child.state = 'in-queue';
      toStack.push(child);
    }

    if (firstGoal) {
      for (let i = toStack.length - 1; i >= 0; i--) stack.push(toStack[i]);
      const path = getPathToRoot(firstGoal);
      r.snap('goal-found',
        `Expand "${tn.label}" → Goal "${firstGoal.label}" discovered at depth ${firstGoal.depth}! Path: ${path.map(n => n.label).join(' → ')}`,
        root, stack.map(t => qe(t, 'dfs-limited')), firstGoal.treeId, path.map(n => n.treeId));
      return r.steps;
    }

    for (let i = toStack.length - 1; i >= 0; i--) stack.push(toStack[i]);
    r.snap('expand',
      `Expand "${tn.label}" (depth=${tn.depth}) → ${candidates.length} child(ren).`,
      root, stack.map(t => qe(t, 'dfs-limited')), tn.treeId, null);
  }

  r.snap('no-solution', `No solution within depth limit ${limit}.`, root, [], null, null);
  return r.steps;
}

/* ── IDDFS ───────────────────────────────────────────────────── */
function runIDDFS(graph) {
  const r = new Runner(graph);
  const start = graph.nodes.get(graph.startNodeId);
  if (!start) return [];

  const maxDepth = Math.max(graph.nodes.size + 3, 8);

  for (let limit = 0; limit <= maxDepth; limit++) {
    const root  = makeTreeNode(start, null, 0);
    root.state  = 'in-queue';
    r.closedList = [];

    r.snap('init',
      `━━━ IDDFS Iteration: depth limit = ${limit} ━━━`,
      root, [], null, null);

    const stack = [root];
    let found   = false;

    // Early goal test on start for this iteration
    if (start.isGoal) {
      root.state = 'goal';
      r.snap('goal-found', `Start "${start.label}" is the goal! Path: ${start.label}`,
        root, [], root.treeId, [root.treeId]);
      found = true;
    }

    while (!found && stack.length) {
      const tn = stack.pop();
      tn.state = 'current';
      r.snap('pop-open', `Pop "${tn.label}" (depth=${tn.depth}, limit=${limit}).`,
        root, stack.map(t => qe(t, 'iddfs')), tn.treeId, null);

      if (tn.depth >= limit) {
        tn.state = 'pruned';
        r.snap('prune', `"${tn.label}" at depth limit (${limit}) — pruned.`,
          root, stack.map(t => qe(t, 'iddfs')), tn.treeId, null);
        continue;
      }

      tn.state = 'expanded';
      r.closedList.push(tn.graphNodeId);

      const ancestorIds = new Set();
      let anc = tn.parent;
      while (anc) { ancestorIds.add(anc.graphNodeId); anc = anc.parent; }

      const candidates = graph.getNeighbors(tn.graphNodeId)
        .filter(({ node }) => !ancestorIds.has(node.id))
        .sort((a, b) => a.node.label < b.node.label ? -1 : a.node.label > b.node.label ? 1 : 0);

      // Process children alphabetically up to (and including) the first goal
      let firstGoal = null;
      const toStack = [];
      for (const { node: nb, edge } of candidates) {
        const child = makeTreeNode(nb, tn, edge.weight);
        tn.children.push(child);
        if (nb.isGoal) {
          child.state = 'goal';
          firstGoal   = child;
          break;
        }
        child.state = 'in-queue';
        toStack.push(child);
      }

      if (firstGoal) {
        for (let i = toStack.length - 1; i >= 0; i--) stack.push(toStack[i]);
        const path = getPathToRoot(firstGoal);
        r.snap('goal-found',
          `Expand "${tn.label}" → Goal "${firstGoal.label}" discovered at depth ${firstGoal.depth} (limit=${limit})! Path: ${path.map(n => n.label).join(' → ')}`,
          root, stack.map(t => qe(t, 'iddfs')), firstGoal.treeId, path.map(n => n.treeId));
        found = true;
        break;
      }

      for (let i = toStack.length - 1; i >= 0; i--) stack.push(toStack[i]);
      r.snap('expand',
        `Expand "${tn.label}" → ${candidates.length} child(ren).`,
        root, stack.map(t => qe(t, 'iddfs')), tn.treeId, null);
    }

    if (found) break;
    r.snap('no-solution',
      `Iteration ${limit} exhausted — increasing depth limit to ${limit + 1}.`,
      root, [], null, null);
  }

  return r.steps;
}

/* ── Uniform Cost Search ─────────────────────────────────────── */
function runUCS(graph) {
  const r   = new Runner(graph);
  const start = graph.nodes.get(graph.startNodeId);
  if (!start) return [];

  const pq  = new MinHeap(e => e.g);
  const root = makeTreeNode(start, null, 0);
  root.state = 'in-queue';
  const Q = t => ({ ...qe(t, 'ucs'), isStale: r.closed.has(t.graphNodeId) });

  r.snap('init', 'Initialize: priority queue ordered by g (path cost).', root, [], null, null);
  pq.push(root);
  r.snap('push-open', `Push start "${start.label}" (g=0).`,
    root, pq.toSorted().map(Q), root.treeId, null);

  while (pq.size) {
    const tn = pq.pop();
    if (r.closed.has(tn.graphNodeId)) {
      tn.state = 'stale';
      r.snap('stale', `Pop "${tn.label}" (g=${tn.g}) — stale duplicate, already developed via better path. Discard.`,
        root, pq.toSorted().map(Q), tn.treeId, null);
      continue;
    }

    tn.state = 'current';
    r.snap('pop-open', `Pop "${tn.label}" — lowest g=${tn.g}.`,
      root, pq.toSorted().map(Q), tn.treeId, null);

    if (tn.isGoal) {
      tn.state = 'goal';
      const path = getPathToRoot(tn);
      r.snap('goal-found',
        `Goal "${tn.label}" found! Optimal cost g=${tn.g}. Path: ${path.map(n => n.label).join(' → ')}`,
        root, pq.toSorted().map(Q), tn.treeId, path.map(n => n.treeId));
      return r.steps;
    }

    r.closed.add(tn.graphNodeId);
    r.closedList.push(tn.graphNodeId);
    tn.state = 'expanded';

    const pushed = [];
    for (const { node: nb, edge } of graph.getNeighbors(tn.graphNodeId)) {
      if (r.closed.has(nb.id)) continue;
      const child = makeTreeNode(nb, tn, edge.weight);
      child.state = 'in-queue';
      tn.children.push(child);
      pq.push(child);
      pushed.push(`${nb.label}(g=${child.g})`);
    }
    const pushDesc = pushed.length ? pushed.join(', ') : 'none';
    r.snap('expand',
      `Expand "${tn.label}" (g=${tn.g}) → pushed: ${pushDesc}.`,
      root, pq.toSorted().map(Q), tn.treeId, null);
  }

  r.snap('no-solution', 'Queue empty — no solution found.', root, [], null, null);
  return r.steps;
}

/* ── Greedy Best First ───────────────────────────────────────── */
function runGreedy(graph) {
  const r   = new Runner(graph);
  const start = graph.nodes.get(graph.startNodeId);
  if (!start) return [];

  const pq  = new MinHeap(e => e.h);
  const root = makeTreeNode(start, null, 0);
  root.state = 'in-queue';
  const Q = t => ({ ...qe(t, 'greedy'), isStale: r.closed.has(t.graphNodeId) });

  r.snap('init', 'Initialize: priority queue ordered by h(n) (heuristic).', root, [], null, null);
  pq.push(root);
  r.snap('push-open', `Push start "${start.label}" (h=${start.h}).`,
    root, pq.toSorted().map(Q), root.treeId, null);

  while (pq.size) {
    const tn = pq.pop();
    if (r.closed.has(tn.graphNodeId)) {
      tn.state = 'stale';
      r.snap('stale', `Pop "${tn.label}" (h=${tn.h}) — stale duplicate, already developed via better path. Discard.`,
        root, pq.toSorted().map(Q), tn.treeId, null);
      continue;
    }

    tn.state = 'current';
    r.snap('pop-open', `Pop "${tn.label}" with lowest h=${tn.h}.`,
      root, pq.toSorted().map(Q), tn.treeId, null);

    if (tn.isGoal) {
      tn.state = 'goal';
      const path = getPathToRoot(tn);
      r.snap('goal-found',
        `Goal "${tn.label}" found! Path: ${path.map(n => n.label).join(' → ')}`,
        root, pq.toSorted().map(Q), tn.treeId, path.map(n => n.treeId));
      return r.steps;
    }

    r.closed.add(tn.graphNodeId);
    r.closedList.push(tn.graphNodeId);
    tn.state = 'expanded';

    const pushed = [];
    for (const { node: nb, edge } of graph.getNeighbors(tn.graphNodeId)) {
      if (r.closed.has(nb.id)) continue;
      const child = makeTreeNode(nb, tn, edge.weight);
      child.state = 'in-queue';
      tn.children.push(child);
      pq.push(child);
      pushed.push(`${nb.label}(h=${nb.h})`);
    }
    const pushDesc = pushed.length ? pushed.join(', ') : 'none';
    r.snap('expand',
      `Expand "${tn.label}" (h=${tn.h}) → pushed: ${pushDesc}.`,
      root, pq.toSorted().map(Q), tn.treeId, null);
  }

  r.snap('no-solution', 'Queue empty — no solution found.', root, [], null, null);
  return r.steps;
}

/* ── A* ──────────────────────────────────────────────────────── */
function runAStar(graph) {
  const r   = new Runner(graph);
  const start = graph.nodes.get(graph.startNodeId);
  if (!start) return [];

  const pq  = new MinHeap(e => e.f);
  const root = makeTreeNode(start, null, 0);
  root.state = 'in-queue';
  const Q = t => ({ ...qe(t, 'astar'), isStale: r.closed.has(t.graphNodeId) });

  r.snap('init', 'Initialize: priority queue ordered by f = g + h.', root, [], null, null);
  pq.push(root);
  r.snap('push-open',
    `Push start "${start.label}" (g=0, h=${start.h}, f=${root.f}).`,
    root, pq.toSorted().map(Q), root.treeId, null);

  while (pq.size) {
    const tn = pq.pop();
    if (r.closed.has(tn.graphNodeId)) {
      tn.state = 'stale';
      r.snap('stale', `Pop "${tn.label}" (f=${tn.f}) — stale duplicate, already developed via better path. Discard.`,
        root, pq.toSorted().map(Q), tn.treeId, null);
      continue;
    }

    tn.state = 'current';
    r.snap('pop-open',
      `Pop "${tn.label}" — lowest f=${tn.f} (g=${tn.g} + h=${tn.h}).`,
      root, pq.toSorted().map(Q), tn.treeId, null);

    if (tn.isGoal) {
      tn.state = 'goal';
      const path = getPathToRoot(tn);
      r.snap('goal-found',
        `Goal "${tn.label}" found! Optimal cost g=${tn.g}. Path: ${path.map(n => n.label).join(' → ')}`,
        root, pq.toSorted().map(Q), tn.treeId, path.map(n => n.treeId));
      return r.steps;
    }

    r.closed.add(tn.graphNodeId);
    r.closedList.push(tn.graphNodeId);
    tn.state = 'expanded';

    const pushed = [];
    for (const { node: nb, edge } of graph.getNeighbors(tn.graphNodeId)) {
      if (r.closed.has(nb.id)) continue;
      const child = makeTreeNode(nb, tn, edge.weight);
      child.state = 'in-queue';
      tn.children.push(child);
      pq.push(child);
      pushed.push(`${nb.label}(g=${child.g},f=${child.f})`);
    }
    const pushDesc = pushed.length ? pushed.join(', ') : 'none';
    r.snap('expand',
      `Expand "${tn.label}" (g=${tn.g}, h=${tn.h}, f=${tn.f}) → pushed: ${pushDesc}.`,
      root, pq.toSorted().map(Q), tn.treeId, null);
  }

  r.snap('no-solution', 'Queue empty — no solution found.', root, [], null, null);
  return r.steps;
}

function runAlgorithm(graph, algoId, depthLimit) {
  switch (algoId) {
    case 'bfs':         return runBFS(graph);
    case 'dfs':         return runDFS(graph);
    case 'dfs-limited': return runDFSLimited(graph, depthLimit);
    case 'iddfs':       return runIDDFS(graph);
    case 'ucs':         return runUCS(graph);
    case 'greedy':      return runGreedy(graph);
    case 'astar':       return runAStar(graph);
    default:            return [];
  }
}

/* ================================================================
   SECTION 7 — RANDOM GRAPH GENERATOR
   ================================================================ */

function generateRandom(difficulty) {
  difficulty = difficulty || 'normal';

  // Difficulty parameters
  const cfg = {
    easy:   { count: [4, 5],  extras: 0.3, weightMax: 5,  hMax: 8,  goals: 2, jitter: 40 },
    normal: { count: [6, 7],  extras: 0.6, weightMax: 9,  hMax: 12, goals: 2, jitter: 60 },
    hard:   { count: [9, 11], extras: 1.0, weightMax: 15, hMax: 20, goals: 1, jitter: 80 },
  }[difficulty];

  const graph  = new GraphModel();
  const count  = cfg.count[0] + Math.floor(Math.random() * (cfg.count[1] - cfg.count[0] + 1));
  const labels = 'ABCDEFGHIJKLMNOP'.split('').slice(0, count);
  const w      = editorSVG.clientWidth  || 700;
  const h      = editorSVG.clientHeight || 500;
  const cx     = w / 2, cy = h / 2;
  const radius = Math.min(w, h) * 0.32;

  // Decide goal indices: always include last node; add cfg.goals - 1 random extras
  const goalSet = new Set([count - 1]);
  const extraGoalCount = Math.max(0, cfg.goals - 1 + (Math.random() < 0.5 ? 1 : 0));
  for (let k = 0; k < extraGoalCount && goalSet.size < count - 1; k++) {
    goalSet.add(Math.floor(Math.random() * (count - 1)));
  }

  const nodeIds = [];
  labels.forEach((lbl, i) => {
    const angle  = (2 * Math.PI * i / count) - Math.PI / 2;
    const jitter = cfg.jitter;
    const x = cx + radius * Math.cos(angle) + (Math.random() - 0.5) * jitter;
    const y = cy + radius * Math.sin(angle) + (Math.random() - 0.5) * jitter;
    const isGoal = goalSet.has(i);
    const h_val  = isGoal ? 0 : Math.floor(Math.random() * cfg.hMax) + 1;
    const node   = graph.addNode(lbl, h_val, isGoal, x, y);
    nodeIds.push(node.id);
  });

  // Spanning tree so graph is connected
  const shuffled = [...nodeIds].sort(() => Math.random() - 0.5);
  for (let i = 1; i < shuffled.length; i++) {
    graph.addEdge(shuffled[i - 1], shuffled[i], Math.floor(Math.random() * cfg.weightMax) + 1);
  }

  // Extra edges
  const extras = Math.floor(count * cfg.extras);
  for (let k = 0; k < extras; k++) {
    const a = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    const b = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    if (a !== b) graph.addEdge(a, b, Math.floor(Math.random() * cfg.weightMax) + 1);
  }

  // Start node = first non-goal node
  graph.startNodeId = nodeIds.find(id => !graph.nodes.get(id).isGoal) || nodeIds[0];

  return graph;
}

/* ================================================================
   SECTION 8 — GRAPH EDITOR (D3 force-directed)
   ================================================================ */

let graphModel   = new GraphModel();
let simulation   = null;
let editorSVG    = null;
let editorZoom   = null;
let _panned      = false;
let editorMode   = 'select';   // 'select' | 'connect'
let connectSourceId = null;
let selectedNodeId  = null;
let selectedEdgeId  = null;

const NODE_R = 26;

function initEditor() {
  editorSVG = document.getElementById('editor-svg');
  const svgSel = d3.select(editorSVG);

  // Background rect — transparent, captures click/mousemove on empty canvas
  svgSel.insert('rect', ':first-child')
    .attr('class', 'svg-bg')
    .attr('width', '100%').attr('height', '100%')
    .attr('fill', 'transparent');

  // Zoom/pan: wheel = zoom anywhere; drag = pan only on background
  editorZoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .filter(event =>
      event.type === 'wheel' ||
      event.target.classList.contains('svg-bg') ||
      event.target === editorSVG)
    .on('start', () => { _panned = false; })
    .on('zoom', event => {
      if (event.sourceEvent && event.sourceEvent.type === 'mousemove') _panned = true;
      svgSel.select('.zoom-group').attr('transform', event.transform);
    });
  svgSel.call(editorZoom);

  // Click on empty area → add node (select mode only)
  svgSel.on('click', function(event) {
    if (_panned) { _panned = false; return; }
    if (!event.target.classList.contains('svg-bg') && event.target !== editorSVG) return;
    if (editorMode === 'connect') { cancelConnect(); return; }
    const t = d3.zoomTransform(editorSVG);
    const [x, y] = t.invert(d3.pointer(event));
    showNodeDialog(x, y);
  });

  // Temp edge follows cursor in connect mode (coords in graph space)
  svgSel.on('mousemove', function(event) {
    const te = document.getElementById('temp-edge');
    if (editorMode === 'connect' && connectSourceId) {
      const src = graphModel.nodes.get(connectSourceId);
      if (!src) return;
      const t = d3.zoomTransform(editorSVG);
      const [mx, my] = t.invert(d3.pointer(event));
      te.style.display = '';
      te.setAttribute('x1', src.x ?? 0);
      te.setAttribute('y1', src.y ?? 0);
      te.setAttribute('x2', mx);
      te.setAttribute('y2', my);
    } else {
      te.style.display = 'none';
    }
  });

  svgSel.on('mouseleave', () => {
    document.getElementById('temp-edge').style.display = 'none';
  });

  document.addEventListener('click', hideCtxMenu);
  document.addEventListener('keydown', handleKeyDown);

  const w = editorSVG.clientWidth  || 700;
  const h = editorSVG.clientHeight || 500;

  simulation = d3.forceSimulation()
    .force('link',    d3.forceLink().id(d => d.id).distance(290).strength(0.22))
    .force('charge',  d3.forceManyBody().strength(-2400))
    .force('center',  d3.forceCenter(w / 2, h / 2))
    .force('collide', d3.forceCollide(NODE_R + 56))
    .alphaDecay(0.018)
    .on('tick', ticked);

  renderGraph();
}

function fitToScreen() {
  const nodes = Array.from(graphModel.nodes.values()).filter(n => n.x != null);
  if (!nodes.length || !editorZoom) return;
  const pad  = 80;
  const svgW = editorSVG.clientWidth  || 700;
  const svgH = editorSVG.clientHeight || 500;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  }
  const gW  = (maxX - minX) || 1;
  const gH  = (maxY - minY) || 1;
  const scale = Math.min((svgW - pad * 2) / gW, (svgH - pad * 2) / gH, 1.8);
  const tx  = (svgW - gW * scale) / 2 - minX * scale;
  const ty  = (svgH - gH * scale) / 2 - minY * scale;
  d3.select(editorSVG).transition().duration(420)
    .call(editorZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function updateSimulation() {
  const nodes = Array.from(graphModel.nodes.values());
  const edges = Array.from(graphModel.edges.values()).map(e => ({
    ...e, source: e.source, target: e.target
  }));

  simulation.nodes(nodes);
  simulation.force('link').links(edges);
  simulation.alpha(0.3).restart();
}

/* ── render nodes & edges ────────────────────────────────────── */
function renderGraph(nodeStates) {
  renderEdges(nodeStates);
  renderNodes(nodeStates);
  updateSimulation();
}

function renderEdges(nodeStates) {
  const svgSel   = d3.select(editorSVG).select('.edge-group');
  const edgesArr = Array.from(graphModel.edges.values());

  const edgeGs = svgSel.selectAll('.edge-g')
    .data(edgesArr, d => d.id)
    .join(enter => {
      const g = enter.append('g').attr('class', 'edge-g');
      g.append('path').attr('class', 'edge-line');
      g.append('rect').attr('class', 'edge-weight-bg').attr('width', 30).attr('height', 18).attr('rx', 4).attr('ry', 4);
      g.append('text').attr('class', 'edge-weight-text');
      g.on('click', (event, d) => { event.stopPropagation(); selectEdge(d.id); });
      return g;
    });

  edgeGs.select('.edge-line')
    .attr('class', d => {
      const state = nodeStates ? getEdgeStateClass(d, nodeStates) : '';
      return 'edge-line ' + state;
    })
    .attr('marker-end', d => {
      if (!nodeStates) return 'url(#arrow-default)';
      return 'url(#arrow-' + getEdgeArrowState(d, nodeStates) + ')';
    });

  edgeGs.select('.edge-weight-text').text(d => d.weight);
  edgeGs.classed('selected-edge', d => d.id === selectedEdgeId);

  // Remove stale
  svgSel.selectAll('.edge-g').filter(d => !graphModel.edges.has(d.id)).remove();
}

function getEdgeStateClass(edge, nodeStates) {
  const s = nodeStates.get(edge.source);
  const t = nodeStates.get(edge.target);
  if (s === 'current' || t === 'current') return 'state-current-edge';
  return '';
}
function getEdgeArrowState(edge, nodeStates) {
  const t = nodeStates.get(edge.target);
  if (t === 'open')    return 'open';
  if (t === 'current') return 'current';
  if (t === 'closed')  return 'closed';
  if (t === 'goal')    return 'goal';
  return 'default';
}

function renderNodes(nodeStates) {
  const svgSel  = d3.select(editorSVG).select('.node-group');
  const nodesArr = Array.from(graphModel.nodes.values());

  const nodeGs = svgSel.selectAll('.node-g')
    .data(nodesArr, d => d.id)
    .join(enter => {
      const g = enter.append('g').attr('class', 'node-g');
      g.append('circle').attr('class', 'goal-ring').attr('r', NODE_R + 7);
      g.append('circle').attr('class', 'node-circle').attr('r', NODE_R);
      g.append('text').attr('class', 'node-label-text').attr('dy', '-0.15em');
      g.append('text').attr('class', 'node-h-text').attr('dy', '1.15em');
      g.append('text').attr('class', 'node-badge').attr('dy', '-1.6em');

      g.call(d3.drag()
        .on('start', dragStart)
        .on('drag',  dragged)
        .on('end',   dragEnd));

      g.on('click', (event, d) => {
        event.stopPropagation();
        if (editorMode === 'connect') {
          handleConnectClick(d.id);
        } else {
          selectNode(d.id);
        }
      });

      g.on('contextmenu', (event, d) => {
        event.preventDefault();
        event.stopPropagation();
        showCtxMenu(event.clientX, event.clientY, d.id);
      });
      return g;
    });

  // Update state class
  nodeGs.attr('class', d => {
    let cls = 'node-g';
    const state = nodeStates ? (nodeStates.get(d.id) || 'unvisited') : 'unvisited';
    cls += ' state-' + state;
    if (d.id === selectedNodeId) cls += ' selected-node';
    if (d.id === connectSourceId) cls += ' connect-source';
    return cls;
  });

  nodeGs.select('.goal-ring').style('display', d => d.isGoal ? 'block' : 'none');
  nodeGs.select('.node-label-text').text(d => d.label);
  nodeGs.select('.node-h-text').text(d => `h=${d.h}`);
  nodeGs.select('.node-badge').text(d => d.id === graphModel.startNodeId ? 'S' : '');

  // Remove stale
  svgSel.selectAll('.node-g').filter(d => !graphModel.nodes.has(d.id)).remove();
}

function ticked() {
  const svgSel = d3.select(editorSVG);
  const edges  = Array.from(graphModel.edges.values());

  svgSel.selectAll('.node-g').attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

  // For edges, look up D3-resolved source/target positions via simulation links
  const linkData = simulation.force('link').links();
  const linkMap  = new Map();
  for (const l of linkData) {
    linkMap.set(l.id, l);
  }

  svgSel.selectAll('.edge-g').each(function(d) {
    const lk = linkMap.get(d.id);
    if (!lk) return;
    const sx = lk.source.x ?? 0, sy = lk.source.y ?? 0;
    const tx = lk.target.x ?? 0, ty = lk.target.y ?? 0;

    const dx = tx - sx, dy = ty - sy;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;   // perpendicular (right-hand side)

    const hasReverse = edges.some(e => e.source === d.target && e.target === d.source);

    let pathD, mx, my;
    if (hasReverse) {
      const BEND = 38;
      const ctrlX = (sx + tx) / 2 + px * BEND;
      const ctrlY = (sy + ty) / 2 + py * BEND;
      const startX = sx + ux * NODE_R + px * 16;
      const startY = sy + uy * NODE_R + py * 16;
      const endX   = tx - ux * (NODE_R + 11) + px * 16;
      const endY   = ty - uy * (NODE_R + 11) + py * 16;
      pathD = `M${startX},${startY} Q${ctrlX},${ctrlY} ${endX},${endY}`;
      mx = 0.25 * startX + 0.5 * ctrlX + 0.25 * endX;
      my = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY;
    } else {
      const endX = tx - ux * (NODE_R + 11);
      const endY = ty - uy * (NODE_R + 11);
      pathD = `M${sx + ux * NODE_R},${sy + uy * NODE_R} L${endX},${endY}`;
      mx = (sx + tx) / 2;
      my = (sy + ty) / 2;
    }

    d3.select(this).select('.edge-line').attr('d', pathD);
    d3.select(this).select('.edge-weight-bg').attr('x', mx - 15).attr('y', my - 9);
    d3.select(this).select('.edge-weight-text').attr('x', mx).attr('y', my);
  });
}

function dragStart(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x; d.fy = d.y;
}
function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
function dragEnd(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null; d.fy = null;
}

/* ── selection helpers ───────────────────────────────────────── */
function selectNode(id) {
  selectedNodeId = id;
  selectedEdgeId = null;
  const node = graphModel.nodes.get(id);
  if (!node) return;

  document.getElementById('node-editor').style.display = '';
  document.getElementById('edge-editor').style.display = 'none';
  document.getElementById('edit-node-label').value = node.label;
  document.getElementById('edit-node-h').value     = node.h;
  document.getElementById('edit-node-goal').checked = node.isGoal;
  renderNodes();
}

function selectEdge(id) {
  selectedEdgeId = id;
  selectedNodeId = null;
  const edge = graphModel.edges.get(id);
  if (!edge) return;

  document.getElementById('edge-editor').style.display = '';
  document.getElementById('node-editor').style.display = 'none';
  document.getElementById('edit-edge-weight').value = edge.weight;
  renderEdges();
}

function clearSelection() {
  selectedNodeId = null;
  selectedEdgeId = null;
  document.getElementById('node-editor').style.display = 'none';
  document.getElementById('edge-editor').style.display = 'none';
}

/* ── connect mode ────────────────────────────────────────────── */
function handleConnectClick(nodeId) {
  if (!connectSourceId) {
    connectSourceId = nodeId;
    d3.select(editorSVG).select('.node-group')
      .selectAll('.node-g').attr('class', d => {
        let cls = 'node-g state-unvisited';
        if (d.id === connectSourceId) cls += ' connect-source';
        return cls;
      });
    setHint('Now click the target node to create an edge, or press Esc to cancel.');
  } else if (connectSourceId === nodeId) {
    cancelConnect();
  } else {
    openEdgeDialog(connectSourceId, nodeId);
  }
}

function cancelConnect() {
  connectSourceId = null;
  document.getElementById('temp-edge').style.display = 'none';
  renderNodes();
  setHint('Click a source node to start drawing an edge.');
}

function setMode(mode) {
  editorMode = mode;
  connectSourceId = null;
  document.getElementById('btn-mode-select').classList.toggle('active', mode === 'select');
  document.getElementById('btn-mode-connect').classList.toggle('active', mode === 'connect');
  if (mode === 'connect') {
    setHint('Click a source node to start drawing an edge.');
    d3.select(editorSVG).style('cursor', 'pointer');
  } else {
    setHint('Click empty area to add a node · Select mode active.');
    d3.select(editorSVG).style('cursor', 'crosshair');
    renderNodes();
  }
}

function setHint(text) {
  document.getElementById('canvas-hint').textContent = text;
}

/* ── context menu ────────────────────────────────────────────── */
let ctxNodeId = null;

function showCtxMenu(x, y, nodeId) {
  ctxNodeId = nodeId;
  const menu = document.getElementById('ctx-menu');
  menu.style.display = '';
  menu.style.left    = x + 'px';
  menu.style.top     = y + 'px';
}

function hideCtxMenu() {
  document.getElementById('ctx-menu').style.display = 'none';
}

/* ── keyboard ────────────────────────────────────────────────── */
function handleKeyDown(event) {
  if (event.key === 'Escape') {
    if (editorMode === 'connect') { cancelConnect(); setMode('select'); }
    clearSelection();
    hideCtxMenu();
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') &&
      document.activeElement.tagName === 'BODY') {
    if (selectedNodeId) {
      graphModel.removeNode(selectedNodeId);
      clearSelection();
      rebuildGraph();
    } else if (selectedEdgeId) {
      graphModel.removeEdge(selectedEdgeId);
      clearSelection();
      rebuildGraph();
    }
  }
}

/* ── rebuild after changes ───────────────────────────────────── */
function rebuildGraph() {
  renderEdges();
  renderNodes();
  updateSimulation();
  updateStartSelect();
  updateAlgoBadge();
}

/* ================================================================
   SECTION 9 — NODE / EDGE DIALOGS
   ================================================================ */

let pendingNodePos = { x: 300, y: 300 };

function showNodeDialog(x, y) {
  pendingNodePos = { x, y };
  const dlg = document.getElementById('dlg-node');
  document.getElementById('dlg-node-title').textContent = 'Add Node';
  document.getElementById('dlg-node-label').value = nextLabel();
  document.getElementById('dlg-node-h').value     = '0';
  document.getElementById('dlg-node-goal').checked = false;
  dlg.showModal();
  document.getElementById('dlg-node-label').focus();
}

function nextLabel() {
  const used = new Set(Array.from(graphModel.nodes.values()).map(n => n.label));
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (!used.has(ch)) return ch;
  }
  return 'X';
}

function openEdgeDialog(sourceId, targetId) {
  const src = graphModel.nodes.get(sourceId);
  const tgt = graphModel.nodes.get(targetId);
  document.getElementById('dlg-edge-label').textContent =
    `Edge weight: ${src.label} → ${tgt.label}`;
  document.getElementById('dlg-edge-weight').value = '1';
  const dlg = document.getElementById('dlg-edge');
  dlg.showModal();
  document.getElementById('dlg-edge-weight').focus();
  dlg._pending = { sourceId, targetId };
}

/* ================================================================
   SECTION 10 — VISUALIZER
   ================================================================ */

let vizSteps   = [];
let vizIdx     = 0;
let playTimer  = null;
let vizGraph   = null;   // snapshot of graphModel at run time

/* The tree SVG uses D3 with a zoom container */
let treeSvgSel    = null;
let treeZoom      = null;
let treeRootG     = null;
let treeLayout    = d3.tree().nodeSize([78, 110]);

function enterVizMode() {
  document.getElementById('editor-view').style.display  = 'none';
  document.getElementById('viz-panel').style.display    = 'flex';
  document.querySelector('.header-actions').style.display = 'none';
  renderVizGraph(null);
  goToStep(0);
  setTimeout(fitVizGraph, 40);
}

function exitVizMode() {
  pausePlayback();
  treeZoom = null;
  d3.select('#tree-svg').select('.tree-svg-bg').remove();  // cleaned up on re-enter
  document.getElementById('viz-panel').style.display    = 'none';
  document.getElementById('editor-view').style.display  = '';
  document.querySelector('.header-actions').style.display = '';
}

/* ── render the static colored graph in viz panel ────────────── */
function renderVizGraph(nodeStates) {
  if (!vizGraph) return;
  const svgEl  = document.getElementById('viz-graph-svg');
  const svgSel = d3.select(svgEl);

  const nodes = Array.from(vizGraph.nodes.values());
  const edges = Array.from(vizGraph.edges.values());
  if (!nodes.length) return;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  /* edges — use raw positions, zoom-group handles scale */
  const edgeSel = svgSel.select('.viz-edges').selectAll('.viz-edge-g')
    .data(edges, d => d.id)
    .join(enter => {
      const g = enter.append('g').attr('class', 'viz-edge-g');
      g.append('path').attr('class', 'edge-line');
      g.append('rect').attr('class', 'edge-weight-bg').attr('width', 30).attr('height', 18).attr('rx', 4);
      g.append('text').attr('class', 'edge-weight-text');
      return g;
    });

  edgeSel.each(function(d) {
    const s = nodeMap.get(d.source); const t = nodeMap.get(d.target);
    if (!s || !t) return;
    const sx = s.x, sy = s.y, tx2 = t.x, ty2 = t.y;
    const dxx = tx2 - sx, dyy = ty2 - sy;
    const len = Math.sqrt(dxx*dxx + dyy*dyy) || 1;
    const ux = dxx/len, uy = dyy/len;
    const px = -uy, py = ux;

    const state = nodeStates ? (nodeStates.get(t.id) || 'unvisited') : 'unvisited';
    const arrowId = { unvisited: 'viz-arrow-default', open: 'viz-arrow-open',
                      current: 'viz-arrow-current', closed: 'viz-arrow-closed',
                      goal: 'viz-arrow-goal', pruned: 'viz-arrow-goal' }[state] || 'viz-arrow-default';

    const hasReverse = edges.some(e => e.source === d.target && e.target === d.source);
    let pathD, mx, my;
    if (hasReverse) {
      const BEND = 38;
      const ctrlX = (sx + tx2) / 2 + px * BEND;
      const ctrlY = (sy + ty2) / 2 + py * BEND;
      const startX = sx + ux * NODE_R + px * 16;
      const startY = sy + uy * NODE_R + py * 16;
      const endX   = tx2 - ux * (NODE_R + 11) + px * 16;
      const endY   = ty2 - uy * (NODE_R + 11) + py * 16;
      pathD = `M${startX},${startY} Q${ctrlX},${ctrlY} ${endX},${endY}`;
      mx = 0.25 * startX + 0.5 * ctrlX + 0.25 * endX;
      my = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY;
    } else {
      const endX = tx2 - ux * (NODE_R + 11);
      const endY = ty2 - uy * (NODE_R + 11);
      pathD = `M${sx + ux * NODE_R},${sy + uy * NODE_R} L${endX},${endY}`;
      mx = (sx + tx2) / 2;
      my = (sy + ty2) / 2;
    }
    d3.select(this).select('.edge-line').attr('d', pathD).attr('marker-end', `url(#${arrowId})`);
    d3.select(this).select('.edge-weight-bg').attr('x', mx - 15).attr('y', my - 9);
    d3.select(this).select('.edge-weight-text').attr('x', mx).attr('y', my).text(d.weight);
  });

  /* nodes */
  const nodeSel = svgSel.select('.viz-nodes').selectAll('.viz-node-g')
    .data(nodes, d => d.id)
    .join(enter => {
      const g = enter.append('g').attr('class', 'viz-node-g');
      g.append('circle').attr('class', 'goal-ring').attr('r', NODE_R + 8);
      g.append('circle').attr('class', 'node-circle').attr('r', NODE_R);
      g.append('text').attr('class', 'node-label-text').attr('dy', '-0.15em');
      g.append('text').attr('class', 'node-h-text').attr('dy', '1.15em');
      g.append('text').attr('class', 'node-badge').attr('dy', '-1.9em');
      return g;
    });

  nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
  nodeSel.attr('class', d => {
    const state = nodeStates ? (nodeStates.get(d.id) || 'unvisited') : 'unvisited';
    return 'viz-node-g state-' + state;
  });
  nodeSel.select('.goal-ring').style('display', d => d.isGoal ? '' : 'none');
  nodeSel.select('.node-label-text').text(d => d.label);
  nodeSel.select('.node-h-text').text(d => `h=${d.h}`);
  nodeSel.select('.node-badge').text(d => d.id === vizGraph.startNodeId ? 'S' : '');
}

function fitVizGraph() {
  const svgEl = document.getElementById('viz-graph-svg');
  if (!vizGraph) return;
  const nodes = Array.from(vizGraph.nodes.values()).filter(n => n.x != null);
  if (!nodes.length) return;
  const svgW = svgEl.clientWidth  || 300;
  const svgH = svgEl.clientHeight || 400;
  const pad  = 54;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
  }
  const gW = maxX - minX || 1;
  const gH = maxY - minY || 1;
  const scale = Math.min((svgW - pad * 2) / gW, (svgH - pad * 2) / gH, 1.8);
  const tx = (svgW - gW * scale) / 2 - minX * scale;
  const ty = (svgH - gH * scale) / 2 - minY * scale;
  d3.select(svgEl).select('.viz-zoom-group')
    .attr('transform', `translate(${tx},${ty}) scale(${scale})`);
}

/* ── step navigation ─────────────────────────────────────────── */
function goToStep(idx) {
  if (!vizSteps.length) return;
  vizIdx = Math.max(0, Math.min(idx, vizSteps.length - 1));
  const step = vizSteps[vizIdx];

  // Update description bar
  const bar = document.getElementById('step-desc');
  bar.textContent = step.description;
  bar.className   = 'step-desc-bar event-' + step.eventType.replace(/-/g, '-');

  // Step counter
  document.getElementById('step-counter').textContent =
    `Step ${vizIdx + 1} / ${vizSteps.length}`;

  // Graph coloring
  renderVizGraph(step.graphNodeStates || buildNodeStateMap(step));

  // Search tree
  renderSearchTree(step);

  // Queue
  renderQueue(step);

  // Closed list
  renderClosed(step);
}

/* Build a nodeState map for the step if not pre-built */
function buildNodeStateMap(step) {
  const map = new Map();
  if (!vizGraph) return map;
  for (const id of vizGraph.nodes.keys()) map.set(id, 'unvisited');

  if (!step.treeRoot) return map;

  // Walk the tree to determine graph-node states
  function walk(tn) {
    const current = map.get(tn.graphNodeId) || 'unvisited';
    let next = current;
    if (tn.state === 'goal')    next = 'goal';
    else if (tn.state === 'current')  next = 'current';
    else if (tn.state === 'expanded') next = (current === 'goal' || current === 'current') ? current : 'closed';
    else if (tn.state === 'in-queue') next = (current === 'goal' || current === 'current' || current === 'closed') ? current : 'open';
    else if (tn.state === 'pruned')   next = (current === 'goal' || current === 'current' || current === 'closed') ? current : 'open';
    map.set(tn.graphNodeId, next);
    for (const ch of tn.children) walk(ch);
  }
  walk(step.treeRoot);

  // Highlight closed list nodes
  for (const id of step.closedList) {
    if (map.get(id) !== 'goal' && map.get(id) !== 'current') map.set(id, 'closed');
  }

  return map;
}

/* ── search tree renderer ────────────────────────────────────── */
function renderSearchTree(step) {
  const svgEl = document.getElementById('tree-svg');
  const sel   = d3.select(svgEl);
  const gSel  = sel.select('#tree-root-g');

  if (!step.treeRoot) {
    gSel.select('.t-links').selectAll('*').remove();
    gSel.select('.t-nodes').selectAll('*').remove();
    return;
  }

  const algo      = getCurrentAlgo();
  const root      = d3.hierarchy(step.treeRoot, d => d.children.length ? d.children : null);
  treeLayout(root);

  // Compute layout bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  root.each(d => {
    minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
    minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
  });

  const container = document.getElementById('tree-svg-container');
  const svgW = container.clientWidth  || 500;
  const svgH = container.clientHeight || 400;

  sel.attr('width', svgW).attr('height', svgH)
     .attr('viewBox', `0 0 ${svgW} ${svgH}`);
  container.style.overflow = 'hidden';

  // Lazy-init D3 zoom so the user can scroll/drag to explore the tree
  if (!treeZoom) {
    sel.insert('rect', ':first-child')
      .attr('class', 'tree-svg-bg')
      .attr('width', '100%').attr('height', '100%')
      .attr('fill', 'transparent');
    treeZoom = d3.zoom()
      .scaleExtent([0.05, 8])
      .on('zoom', event => {
        d3.select(svgEl).select('#tree-root-g').attr('transform', event.transform);
      });
    sel.call(treeZoom);
  }

  const nodeR = 20;
  const pad   = nodeR + 28;
  const botEx = nodeR + 32;
  const treeW = (maxX - minX) || 1;
  const treeH = (maxY - minY) || 1;

  const scale = Math.min(
    (svgW - pad * 2) / treeW,
    (svgH - pad - botEx) / treeH,
    2.2
  );

  const tx = svgW / 2 - ((minX + maxX) / 2) * scale;
  const ty = pad - minY * scale;

  // Auto-fit: set zoom transform (user can then scroll to explore further)
  sel.call(treeZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

  const solutionSet = new Set(step.solutionPath || []);

  /* ── links ── */
  const linkGen = d3.linkVertical().x(d => d.x).y(d => d.y);

  gSel.select('.t-links').selectAll('.t-link')
    .data(root.links(), d => d.target.data.treeId)
    .join(
      enter => enter.append('path').attr('class', 't-link')
        .attr('d', d => {
          const p = { x: d.source.x, y: d.source.y };
          return linkGen({ source: p, target: p });
        })
        .call(e => e.transition().duration(280)
          .attr('d', d => linkGen({ source: d.source, target: d.target }))),
      update => update.transition().duration(200)
        .attr('d', d => linkGen({ source: d.source, target: d.target }))
        .attr('class', d => 't-link' + (solutionSet.has(d.target.data.treeId) ? ' solution-path' : '')),
      exit => exit.transition().duration(150).style('opacity', 0).remove()
    )
    .attr('class', d => 't-link' + (solutionSet.has(d.target.data.treeId) ? ' solution-path' : ''));

  /* ── nodes ── */
  const nodeGs = gSel.select('.t-nodes').selectAll('.t-node-g')
    .data(root.descendants(), d => d.data.treeId)
    .join(
      enter => {
        const g = enter.append('g').attr('class', 't-node-g')
          .attr('transform', d => {
            const p = d.parent ? d.parent : d;
            return `translate(${p.x},${p.y})`;
          });
        g.append('circle').attr('class', 't-circle-pulse').attr('r', 22);
        g.append('circle').attr('class', 't-circle-bg').attr('r', 18);
        g.append('text').attr('class', 't-label').attr('dy', '0.35em');
        g.append('text').attr('class', 't-edge-w').attr('y', -22).attr('font-size', '9px').attr('text-anchor', 'middle').attr('fill', 'var(--text-dim)');
        // Value chips below the circle (visible near the node)
        g.append('text').attr('class', 't-gval').attr('y', 26).attr('dy', '0.35em').attr('text-anchor', 'middle').attr('font-size', '9.5px').attr('font-weight', '600').attr('fill', 'var(--accent)');
        g.append('text').attr('class', 't-hval').attr('y', 37).attr('dy', '0.35em').attr('text-anchor', 'middle').attr('font-size', '9.5px').attr('font-weight', '600').attr('fill', 'var(--purple)');
        g.append('text').attr('class', 't-fval').attr('y', 49).attr('dy', '0.35em').attr('text-anchor', 'middle').attr('font-size', '10.5px').attr('font-weight', '700').attr('fill', 'var(--green)');
        g.append('text').attr('class', 't-dval').attr('y', 26).attr('dy', '0.35em').attr('text-anchor', 'middle').attr('font-size', '9.5px').attr('font-weight', '600').attr('fill', 'var(--orange)');
        g.transition().duration(280).attr('transform', d => `translate(${d.x},${d.y})`);
        return g;
      },
      update => update.transition().duration(200)
        .attr('transform', d => `translate(${d.x},${d.y})`),
      exit => exit.transition().duration(150).style('opacity', 0).remove()
    );

  // Update classes and content without transition (immediate)
  gSel.select('.t-nodes').selectAll('.t-node-g')
    .attr('class', d => {
      const tn = d.data;
      let cls = 't-node-g ';
      if (solutionSet.has(tn.treeId) && tn.treeId !== step.currentTreeNodeId) cls += 'tn-solution';
      else if (tn.treeId === step.currentTreeNodeId) cls += 'tn-' + tn.state;
      else cls += 'tn-' + tn.state;
      return cls;
    });

  gSel.select('.t-nodes').selectAll('.t-node-g').each(function(d) {
    const tn  = d.data;
    const sel = d3.select(this);
    sel.select('.t-label').text(tn.label);
    sel.select('.t-edge-w').text(tn.pathEdgeWeight > 0 ? `+${tn.pathEdgeWeight}` : '');

    const showG = ['ucs', 'astar'].includes(algo);
    const showH = ['greedy', 'astar'].includes(algo);
    const showF = algo === 'astar';
    const showD = !showG && !showH;

    sel.select('.t-gval').text(showG ? `g=${tn.g}` : '');
    sel.select('.t-hval').text(showH ? `h=${tn.h}` : '');
    sel.select('.t-fval').text(showF ? `f=${tn.f}` : '');
    sel.select('.t-dval').text(showD ? `d=${tn.depth}` : '');
  });
}

function getTreeNodeValue(tn, algo) {
  switch (algo) {
    case 'ucs':         return `g=${tn.g}`;
    case 'greedy':      return `h=${tn.h}`;
    case 'astar':       return `g=${tn.g}  h=${tn.h}  f=${tn.f}`;
    case 'dfs-limited':
    case 'iddfs':       return `d=${tn.depth}`;
    default:            return `d=${tn.depth}`;
  }
}

/* ── queue renderer ──────────────────────────────────────────── */
function renderQueue(step) {
  const list = document.getElementById('queue-list');
  const entries = step.openQueue || [];

  document.getElementById('queue-count').textContent = entries.length;

  if (!entries.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">▤</div>Queue is empty</div>';
    return;
  }

  list.innerHTML = '';
  entries.forEach((e, i) => {
    const div = document.createElement('div');
    div.className = 'queue-item' + (e.isNext ? ' is-next' : '') + (e.isStale ? ' is-stale' : '');

    const rank  = document.createElement('span');
    rank.className = 'qi-rank';
    rank.textContent = i + 1;

    const label = document.createElement('span');
    label.className = 'qi-label';
    label.textContent = e.label;

    const vals  = document.createElement('span');
    vals.className = 'qi-values';
    vals.appendChild(makeChip(e, e.algo || getCurrentAlgo()));

    div.appendChild(rank);
    div.appendChild(label);
    div.appendChild(vals);
    list.appendChild(div);
  });
}

function makeChip(e, algo) {
  const frag = document.createDocumentFragment();
  function chip(text, cls) {
    const s = document.createElement('span');
    s.className = 'qi-chip ' + cls;
    s.textContent = text;
    frag.appendChild(s);
  }
  switch (algo) {
    case 'ucs':         chip(`g=${e.g}`, 'chip-g'); break;
    case 'greedy':      chip(`h=${e.h}`, 'chip-h'); break;
    case 'astar':
      chip(`g=${e.g}`, 'chip-g');
      chip(`h=${e.h}`, 'chip-h');
      chip(`f=${e.f}`, 'chip-f');
      break;
    case 'bfs':         chip(`d=${e.depth}`, 'chip-depth'); break;
    case 'dfs':         chip(`d=${e.depth}`, 'chip-depth'); break;
    case 'dfs-limited': chip(`d=${e.depth}`, 'chip-depth'); break;
    case 'iddfs':       chip(`d=${e.depth}`, 'chip-depth'); break;
  }
  return frag;
}

/* ── closed list renderer ────────────────────────────────────── */
function renderClosed(step) {
  const list    = document.getElementById('closed-list');
  const entries = step.closedList || [];

  document.getElementById('closed-count').textContent = entries.length;

  if (!entries.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">▣</div>No nodes developed yet</div>';
    return;
  }

  list.innerHTML = '';
  entries.forEach((id, i) => {
    const node = vizGraph ? vizGraph.nodes.get(id) : null;
    const label = node ? node.label : id;
    const div = document.createElement('div');
    div.className = 'closed-item';
    div.innerHTML = `<span class="ci-num">${i + 1}</span><span class="ci-label">${label}</span>`;
    list.appendChild(div);
  });
}

/* ── playback controls ───────────────────────────────────────── */
function startPlayback() {
  if (vizIdx >= vizSteps.length - 1) goToStep(0);
  const speed = 2200 - parseInt(document.getElementById('inp-speed').value);
  playTimer = setInterval(() => {
    if (vizIdx >= vizSteps.length - 1) {
      pausePlayback();
    } else {
      goToStep(vizIdx + 1);
    }
  }, speed);
  document.getElementById('btn-play').textContent = '⏸ Pause';
  document.getElementById('btn-play').classList.add('playing');
}

function pausePlayback() {
  clearInterval(playTimer);
  playTimer = null;
  document.getElementById('btn-play').textContent = '▶ Play';
  document.getElementById('btn-play').classList.remove('playing');
}

function togglePlayback() {
  if (playTimer) pausePlayback(); else startPlayback();
}

/* ================================================================
   SECTION 11 — UI HELPERS
   ================================================================ */

function updateStartSelect() {
  const sel = document.getElementById('sel-start');
  const cur = graphModel.startNodeId;
  sel.innerHTML = '<option value="">— select start node —</option>';
  for (const n of graphModel.nodes.values()) {
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.textContent = n.label + (n.isGoal ? ' (goal)' : '');
    if (n.id === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}

function getCurrentAlgo() {
  return document.getElementById('sel-algo').value;
}

function updateAlgoBadge() {
  const algo = getCurrentAlgo();
  const queueTypes = {
    bfs: 'FIFO', dfs: 'LIFO', 'dfs-limited': 'LIFO',
    iddfs: 'LIFO', ucs: 'Min-heap', greedy: 'Min-heap', astar: 'Min-heap'
  };
  const keys = {
    bfs: '—', dfs: '—', 'dfs-limited': 'depth',
    iddfs: 'depth', ucs: 'g', greedy: 'h', astar: 'f = g+h'
  };
  const closedSet = {
    bfs: 'Yes', dfs: 'Yes', 'dfs-limited': 'Path only',
    iddfs: 'Path only', ucs: 'Yes', greedy: 'Yes', astar: 'Yes'
  };

  document.getElementById('badge-queue-type').textContent = queueTypes[algo] || '—';
  document.getElementById('badge-key').textContent         = keys[algo]       || '—';
  document.getElementById('badge-closed').textContent      = closedSet[algo]  || '—';

  const depthGroup = document.getElementById('depth-group');
  depthGroup.style.display = algo === 'dfs-limited' ? '' : 'none';
}

function showToast(msg, type = 'info') {
  const div = document.createElement('div');
  div.className  = `toast toast-${type}`;
  div.textContent = msg;
  document.getElementById('toasts').appendChild(div);
  setTimeout(() => { div.style.animation = 'fadeOut 0.3s ease forwards'; setTimeout(() => div.remove(), 300); }, 2800);
}

function saveGraph() {
  const data = {
    version: 1,
    startNodeId: graphModel.startNodeId,
    nodes: Array.from(graphModel.nodes.values()).map(n => ({
      id: n.id, label: n.label, h: n.h, isGoal: n.isGoal, x: n.x ?? 0, y: n.y ?? 0
    })),
    edges: Array.from(graphModel.edges.values()).map(e => ({
      id: e.id, source: e.source, target: e.target, weight: e.weight
    }))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'graph.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Graph saved to graph.json', 'success');
}

function loadGraphFromFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.nodes || !data.edges) throw new Error('Invalid format');
      const graph = new GraphModel();
      for (const n of data.nodes) {
        graph.nodes.set(n.id, { id: n.id, label: n.label, h: n.h ?? 0, isGoal: !!n.isGoal, x: n.x, y: n.y });
      }
      for (const ed of data.edges) {
        graph.edges.set(ed.id, { id: ed.id, source: ed.source, target: ed.target, weight: ed.weight ?? 1 });
      }
      graph.startNodeId = data.startNodeId || null;
      graphModel = graph;
      clearSelection();
      cancelConnect();
      d3.select(editorSVG).select('.edge-group').selectAll('*').remove();
      d3.select(editorSVG).select('.node-group').selectAll('*').remove();
      renderGraph();
      updateStartSelect();
      updateAlgoBadge();
      setTimeout(fitToScreen, 600);
      showToast(`Graph loaded: ${data.nodes.length} nodes, ${data.edges.length} edges.`, 'success');
    } catch (err) {
      showToast('Could not load file — make sure it\'s a valid graph JSON.', 'error');
    }
  };
  reader.readAsText(file);
}

function addGoalNode() {
  const nonGoals = Array.from(graphModel.nodes.values()).filter(n => !n.isGoal);
  if (!nonGoals.length) { showToast('All nodes are already goals.', 'warn'); return; }
  const pick = nonGoals[Math.floor(Math.random() * nonGoals.length)];
  graphModel.updateNode(pick.id, { isGoal: true, h: 0 });
  rebuildGraph();
  showToast(`${pick.label} is now a goal node.`, 'success');
}

function removeGoalNode() {
  const goals = Array.from(graphModel.nodes.values()).filter(n => n.isGoal);
  if (!goals.length) { showToast('No goal nodes to remove.', 'warn'); return; }
  const pick = goals[Math.floor(Math.random() * goals.length)];
  graphModel.updateNode(pick.id, { isGoal: false, h: Math.floor(Math.random() * 8) + 2 });
  rebuildGraph();
  showToast(`${pick.label} is no longer a goal.`, 'info');
}

/* ================================================================
   SECTION 12 — APP BOOTSTRAP
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initEditor();

  /* ── Mode buttons ─── */
  document.getElementById('btn-mode-select').addEventListener('click', () => setMode('select'));
  document.getElementById('btn-mode-connect').addEventListener('click', () => setMode('connect'));

  /* ── Algorithm selector ─── */
  document.getElementById('sel-algo').addEventListener('change', updateAlgoBadge);
  updateAlgoBadge();

  /* ── Start node selector ─── */
  document.getElementById('sel-start').addEventListener('change', e => {
    graphModel.startNodeId = e.target.value || null;
    renderNodes();
  });

  /* ── Random graph ─── */
  document.getElementById('btn-random').addEventListener('click', () => {
    const difficulty = document.getElementById('sel-difficulty').value;
    graphModel = generateRandom(difficulty);
    clearSelection();
    cancelConnect();
    const svgSel = d3.select(editorSVG);
    svgSel.select('.edge-group').selectAll('*').remove();
    svgSel.select('.node-group').selectAll('*').remove();
    renderGraph();
    updateStartSelect();
    updateAlgoBadge();
    setTimeout(fitToScreen, 650);
    showToast(`Random graph generated (${difficulty})!`, 'success');
  });

  /* ── Clear ─── */
  document.getElementById('btn-clear').addEventListener('click', () => {
    graphModel.clear();
    clearSelection();
    d3.select(editorSVG).select('.edge-group').selectAll('*').remove();
    d3.select(editorSVG).select('.node-group').selectAll('*').remove();
    if (editorZoom) d3.select(editorSVG).call(editorZoom.transform, d3.zoomIdentity);
    updateStartSelect();
    showToast('Graph cleared.', 'info');
  });

  /* ── Goal node toggle buttons ─── */
  document.getElementById('btn-goal-add').addEventListener('click', addGoalNode);
  document.getElementById('btn-goal-remove').addEventListener('click', removeGoalNode);

  /* ── Save / Load ─── */
  document.getElementById('btn-save').addEventListener('click', saveGraph);
  document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('inp-load-file').value = '';  // reset so same file can be re-loaded
    document.getElementById('inp-load-file').click();
  });
  document.getElementById('inp-load-file').addEventListener('change', e => {
    if (e.target.files[0]) loadGraphFromFile(e.target.files[0]);
  });

  /* ── Fit button + F key ─── */
  document.getElementById('btn-fit').addEventListener('click', fitToScreen);
  document.addEventListener('keydown', e => {
    if (e.key === 'f' || e.key === 'F') {
      const vizVisible = document.getElementById('viz-panel').style.display !== 'none';
      if (!vizVisible && document.activeElement.tagName === 'BODY') fitToScreen();
    }
  });

  /* ── Add node dialog ─── */
  document.getElementById('dlg-node-ok').addEventListener('click', () => {
    const label  = document.getElementById('dlg-node-label').value.trim();
    const h      = parseFloat(document.getElementById('dlg-node-h').value) || 0;
    const isGoal = document.getElementById('dlg-node-goal').checked;
    if (!label) { showToast('Label cannot be empty.', 'error'); return; }
    const node = graphModel.addNode(label, h, isGoal, pendingNodePos.x, pendingNodePos.y);
    if (!graphModel.startNodeId) graphModel.startNodeId = node.id;
    document.getElementById('dlg-node').close();
    rebuildGraph();
  });

  document.getElementById('dlg-node-cancel').addEventListener('click', () => {
    document.getElementById('dlg-node').close();
  });

  document.getElementById('dlg-node').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('dlg-node-ok').click();
  });

  /* ── Add edge dialog ─── */
  document.getElementById('dlg-edge-ok').addEventListener('click', () => {
    const dlg    = document.getElementById('dlg-edge');
    const weight = parseFloat(document.getElementById('dlg-edge-weight').value);
    if (isNaN(weight) || weight < 0) { showToast('Invalid weight.', 'error'); return; }
    const { sourceId, targetId } = dlg._pending;
    const edge = graphModel.addEdge(sourceId, targetId, weight);
    if (!edge) showToast('Edge already exists.', 'warn');
    dlg.close();
    connectSourceId = null;
    document.getElementById('temp-edge').style.display = 'none';
    if (editorMode === 'connect') setHint('Click a source node to start drawing an edge.');
    rebuildGraph();
  });

  document.getElementById('dlg-edge-cancel').addEventListener('click', () => {
    document.getElementById('dlg-edge').close();
    connectSourceId = null;
    document.getElementById('temp-edge').style.display = 'none';
    if (editorMode === 'connect') renderNodes();
  });

  document.getElementById('dlg-edge').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('dlg-edge-ok').click();
  });

  /* ── Node editor panel ─── */
  document.getElementById('btn-node-update').addEventListener('click', () => {
    if (!selectedNodeId) return;
    const label  = document.getElementById('edit-node-label').value.trim();
    const h      = parseFloat(document.getElementById('edit-node-h').value) || 0;
    const isGoal = document.getElementById('edit-node-goal').checked;
    if (!label) { showToast('Label cannot be empty.', 'error'); return; }
    graphModel.updateNode(selectedNodeId, { label, h, isGoal });
    rebuildGraph();
    showToast('Node updated.', 'success');
  });

  document.getElementById('btn-node-set-start').addEventListener('click', () => {
    if (!selectedNodeId) return;
    graphModel.startNodeId = selectedNodeId;
    rebuildGraph();
    showToast('Start node set.', 'success');
  });

  document.getElementById('btn-node-delete').addEventListener('click', () => {
    if (!selectedNodeId) return;
    graphModel.removeNode(selectedNodeId);
    clearSelection();
    rebuildGraph();
  });

  /* ── Edge editor panel ─── */
  document.getElementById('btn-edge-update').addEventListener('click', () => {
    if (!selectedEdgeId) return;
    const w = parseFloat(document.getElementById('edit-edge-weight').value);
    if (isNaN(w) || w < 0) { showToast('Invalid weight.', 'error'); return; }
    graphModel.updateEdge(selectedEdgeId, { weight: w });
    rebuildGraph();
    showToast('Edge updated.', 'success');
  });

  document.getElementById('btn-edge-delete').addEventListener('click', () => {
    if (!selectedEdgeId) return;
    graphModel.removeEdge(selectedEdgeId);
    clearSelection();
    rebuildGraph();
  });

  /* ── Context menu ─── */
  document.getElementById('ctx-set-start').addEventListener('click', () => {
    if (ctxNodeId) {
      graphModel.startNodeId = ctxNodeId;
      rebuildGraph();
      showToast('Start node set.', 'success');
    }
    hideCtxMenu();
  });

  document.getElementById('ctx-delete').addEventListener('click', () => {
    if (ctxNodeId) {
      graphModel.removeNode(ctxNodeId);
      if (selectedNodeId === ctxNodeId) clearSelection();
      rebuildGraph();
    }
    hideCtxMenu();
  });

  /* ── Run algorithm ─── */
  document.getElementById('btn-run').addEventListener('click', () => {
    if (!graphModel.startNodeId) {
      showToast('Please select a start node first.', 'error'); return;
    }
    if (!graphModel.nodes.size) {
      showToast('Graph is empty.', 'error'); return;
    }
    const goalNodes = Array.from(graphModel.nodes.values()).filter(n => n.isGoal);
    if (!goalNodes.length) {
      showToast('Please mark at least one node as a goal.', 'warn'); return;
    }

    const algo  = getCurrentAlgo();
    const limit = parseInt(document.getElementById('inp-depth').value) || 3;

    // Snapshot positions from force sim
    vizGraph = new GraphModel();
    vizGraph.startNodeId = graphModel.startNodeId;
    for (const [id, n] of graphModel.nodes) {
      vizGraph.nodes.set(id, { ...n });
    }
    for (const [id, e] of graphModel.edges) {
      vizGraph.edges.set(id, { ...e });
    }

    vizSteps = runAlgorithm(vizGraph, algo, limit);
    if (!vizSteps.length) {
      showToast('Algorithm produced no steps. Check your graph.', 'error'); return;
    }

    enterVizMode();
  });

  /* ── Back to editor ─── */
  document.getElementById('btn-back').addEventListener('click', exitVizMode);

  /* ── Playback controls ─── */
  document.getElementById('btn-prev').addEventListener('click', () => {
    pausePlayback();
    goToStep(vizIdx - 1);
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    pausePlayback();
    goToStep(vizIdx + 1);
  });
  document.getElementById('btn-play').addEventListener('click', togglePlayback);

  document.addEventListener('keydown', e => {
    const vizVisible = document.getElementById('viz-panel').style.display !== 'none';
    if (!vizVisible) return;
    if (e.key === 'ArrowLeft')  { pausePlayback(); goToStep(vizIdx - 1); }
    if (e.key === 'ArrowRight') { pausePlayback(); goToStep(vizIdx + 1); }
    if (e.key === ' ') { e.preventDefault(); togglePlayback(); }
  });

  document.getElementById('inp-speed').addEventListener('input', function() {
    const ms = 2200 - parseInt(this.value);
    document.getElementById('speed-display').textContent = (ms / 1000).toFixed(1) + 's';
    if (playTimer) { pausePlayback(); startPlayback(); }
  });

  /* ── Theme toggle ─── */
  document.getElementById('btn-theme').addEventListener('click', () => {
    const isLight = document.documentElement.dataset.theme === 'light';
    document.documentElement.dataset.theme = isLight ? '' : 'light';
    document.getElementById('btn-theme').textContent = isLight ? '☾' : '☀';
  });

  /* ── Generate a random graph on load ─── */
  graphModel = generateRandom('normal');
  renderGraph();
  updateStartSelect();
  updateAlgoBadge();
  setTimeout(fitToScreen, 700);
});
