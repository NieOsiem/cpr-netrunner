/**
 * architecture.js  — Grid-based data model for CPR net architectures.
 *
 * A net architecture is a 2D grid (gridWidth × gridHeight).
 * Each cell may have a node or be empty.
 * Connections are an explicit undirected edge list [[idA, idB], ...].
 * Any two adjacent nodes can be connected independently — supports mazes,
 * cycles, and paths that reconverge, beyond the standard CPR rulebook tree.
 *
 * Storage: one world-setting per architecture ("arch_{uuid}"), never
 * touching actors, items or scenes.
 */

import { getTileImagePath, tileExt } from "./node-defs.js";
import { MODULE_ID } from "../utils.js";

// ── UUID ──────────────────────────────────────────────────────────────────────
export function generateId() { return foundry.utils.randomID(16); }

// ── Index ─────────────────────────────────────────────────────────────────────
function getIndex() {
  try { return JSON.parse(game.settings.get(MODULE_ID, "arch_index")) ?? []; }
  catch { return []; }
}
async function setIndex(ids) {
  await game.settings.set(MODULE_ID, "arch_index", JSON.stringify(ids));
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function loadArchitecture(id) {
  try {
    const raw = game.settings.get(MODULE_ID, `arch_${id}`);
    if (!raw || raw === "{}") return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function loadAllArchitectures() {
  return getIndex().map(id => loadArchitecture(id)).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveArchitecture(arch) {
  if (!arch.id) arch.id = generateId();
  arch.updatedAt = Date.now();
  if (!arch.createdAt) arch.createdAt = arch.updatedAt;

  const key = `arch_${arch.id}`;
  if (!game.settings.settings.has(`${MODULE_ID}.${key}`)) {
    game.settings.register(MODULE_ID, key, { scope:"world", config:false, type:String, default:"{}" });
  }
  await game.settings.set(MODULE_ID, key, JSON.stringify(arch));

  const ids = getIndex();
  if (!ids.includes(arch.id)) { ids.push(arch.id); await setIndex(ids); }
  return arch;
}

export async function deleteArchitecture(id) {
  const key = `arch_${id}`;
  if (game.settings.settings.has(`${MODULE_ID}.${key}`))
    await game.settings.set(MODULE_ID, key, "{}");
  await setIndex(getIndex().filter(i => i !== id));
}

// ── Node factory ──────────────────────────────────────────────────────────────
export function createNode(type, id = null, col = 0, row = 0, data = {}) {
  const nodeId = id ?? generateId();
  const base = {
    id: nodeId, col, row, type,
    label:    "",    // primary label override (replaces auto-label)
    subtitle: "",    // secondary label shown below (e.g. "Arasaka.rar")
    gmNotes:  "",    // GM-only notes, never shown to players
    tileVariant: Math.ceil(Math.random() * 13),
    data: {},
  };
  switch (type) {
    case "black_ice":    base.data = { spawns: [], ...data }; break;
    case "password":     base.data = { dv: 8,             ...data }; break;
    case "file":         base.data = { dv: 8, label: "File", contents: "", ...data }; break;
    case "control_node": base.data = { dv: 8, label: "System", defenses: "", ...data }; break;
    case "system":       base.data = { label: "ROOT", ...data }; break;
    case "demon":        base.data = { spawns: [], ...data }; break;
    default:             base.data = { ...data }; break;
  }
  return base;
}

// ── Architecture factory ───────────────────────────────────────────────────────
export function createBlankArchitecture(name = "New Architecture") {
  const startNode = createNode("empty", null, 0, 4);
  return {
    id: generateId(),
    name,
    difficulty: "standard",
    notes: "",
    gridWidth:  10,
    gridHeight:  8,
    entryNodeId: startNode.id,
    nodes: { [startNode.id]: startNode },
    connections: [],   // [[idA, idB], ...]  — unordered pairs
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Grid position helpers ─────────────────────────────────────────────────────
export function getNodeAtPos(arch, col, row) {
  return Object.values(arch.nodes).find(n => n.col === col && n.row === row) ?? null;
}

export function addNodeAtPos(arch, col, row, type = "empty", data = {}) {
  if (getNodeAtPos(arch, col, row)) return null;           // cell occupied
  if (col >= arch.gridWidth)  arch.gridWidth  = col + 1;  // auto-expand
  if (row >= arch.gridHeight) arch.gridHeight = row + 1;
  const node = createNode(type, null, col, row, data);
  arch.nodes[node.id] = node;
  if (!arch.entryNodeId) arch.entryNodeId = node.id;
  arch.updatedAt = Date.now();
  return node;
}

export function removeNode(arch, nodeId) {
  arch.connections = arch.connections.filter(([a, b]) => a !== nodeId && b !== nodeId);
  delete arch.nodes[nodeId];
  if (arch.entryNodeId === nodeId)
    arch.entryNodeId = Object.keys(arch.nodes)[0] ?? null;
  arch.updatedAt = Date.now();
}

export function updateNodeData(arch, nodeId, changes) {
  const node = arch.nodes[nodeId];
  if (!node) return null;
  if (changes.type && changes.type !== node.type) {
    // Type change: rebuild with defaults for new type, preserve position + variant
    const newNode = createNode(changes.type, node.id, node.col, node.row, changes.data ?? {});
    newNode.label       = changes.label ?? node.label;
    newNode.tileVariant = node.tileVariant;
    arch.nodes[nodeId]  = newNode;
  } else {
    if (changes.label !== undefined) node.label = changes.label;
    if (changes.data)                node.data  = { ...node.data, ...changes.data };
  }
  arch.updatedAt = Date.now();
  return arch.nodes[nodeId];
}

// ── Connection helpers ─────────────────────────────────────────────────────────
export function areConnected(arch, id1, id2) {
  return arch.connections.some(([a, b]) =>
    (a === id1 && b === id2) || (a === id2 && b === id1));
}

export function addConnection(arch, id1, id2) {
  if (!id1 || !id2 || id1 === id2 || areConnected(arch, id1, id2)) return;
  arch.connections.push([id1, id2]);
  arch.updatedAt = Date.now();
}

export function removeConnection(arch, id1, id2) {
  const before = arch.connections.length;
  arch.connections = arch.connections.filter(([a, b]) =>
    !((a === id1 && b === id2) || (a === id2 && b === id1)));
  if (arch.connections.length !== before) arch.updatedAt = Date.now();
}

export function toggleConnection(arch, id1, id2) {
  if (areConnected(arch, id1, id2)) { removeConnection(arch, id1, id2); return false; }
  addConnection(arch, id1, id2); return true;
}

export function getConnectedNodes(arch, nodeId) {
  return arch.connections
    .filter(([a, b]) => a === nodeId || b === nodeId)
    .map(([a, b])    => arch.nodes[a === nodeId ? b : a])
    .filter(Boolean);
}

// ── Display helpers ───────────────────────────────────────────────────────────
export function getNodeDisplayLabel(node) {
  if (!node) return "?";
  if (node.label) return node.label;
  switch (node.type) {
    case "black_ice": {
      const names = (node.data.spawns ?? []).map(s => s.iceName ?? "ICE");
      return names.length ? names.join(" + ") : "ICE Spawn";
    }
    case "password":     return `PWD DV${node.data.dv ?? "?"}`;
    case "file":         return `${node.data.label || "File"} DV${node.data.dv ?? "?"}`;
    case "control_node": return `${node.data.label || "CTRL"} DV${node.data.dv ?? "?"}`;
    case "demon": {
      const names = (node.data.spawns ?? []).map(s => s.demonName ?? "Demon");
      return names.length ? names.join(" + ") : "Demon Spawn";
    }
    case "system":       return node.data.label || "ROOT";
    case "empty":        return "Node";
    default:             return node.type;
  }
}

export function getNodeTileUrl(node, tilesRoot) {
  if (node.tileUrl) {
    // tileUrl stores the path stem (no extension) so the animated/static
    // setting is respected per-client without needing to re-pick.
    return `${node.tileUrl}.${tileExt()}`;
  }
  return getTileImagePath(tilesRoot, node.type, node.data, node.tileVariant ?? 1);
}

export function countNodes(arch) {
  return Object.keys(arch.nodes ?? {}).length;
}
