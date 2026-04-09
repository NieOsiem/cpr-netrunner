/**
 * run-state.js
 * Active netrun state — unified token system.
 *
 * Tokens represent everything that moves: runners, Black ICE, and Demons.
 * Architecture nodes are static containers/spawn points; all dynamic state
 * (position, REZ, active) lives here.
 *
 * Token shape:
 * {
 *   id, type: "runner"|"black_ice"|"demon",
 *   name,
 *   // runner-specific
 *   userId, isNPC, interfaceRank, netActionsTotal, netActionsUsed,
 *   color, disposition,
 *   // ice/demon-specific
 *   iceName, demonName,
 *   // shared
 *   homeNodeId,    // where the token was spawned / originally lives
 *   currentNodeId, // where it is right now (null = not on map)
 *   currentRez,    // current REZ (null = use base from statblock)
 *   maxRez,        // max REZ (copied from statblock at spawn)
 *   active,        // ICE/demon: is it chasing someone?
 *   targetTokenId, // ICE/demon: which token it's targeting
 *   iconPath,      // optional custom icon override
 * }
 */

import { generateId } from "./architecture.js";
import { BLACK_ICE, DEMONS } from "./node-defs.js";
import { MODULE_ID } from "../utils.js";

// ── NET Actions by Interface Rank ─────────────────────────────────────────────
export function netActionsFromRank(rank) {
  if (rank >= 10) return 5;
  if (rank >= 7)  return 4;
  if (rank >= 4)  return 3;
  return 2;
}

// ── Token factories ───────────────────────────────────────────────────────────

export function createRunnerToken(opts = {}) {
  const rank = opts.interfaceRank ?? 4;
  const maxHp = opts.maxHp ?? (opts.isNPC ? 20 : 40);
  return {
    id:              generateId(),
    type:            "runner",
    name:            opts.name          ?? "Runner",
    iconPath:        opts.iconPath      ?? null,   // custom token icon path
    userId:          opts.userId        ?? null,
    isNPC:           opts.isNPC         ?? false,
    interfaceRank:   rank,
    netActionsTotal: netActionsFromRank(rank),
    netActionsUsed:  0,
    maxHp,
    currentHp:       opts.currentHp     ?? maxHp,
    color:           opts.color         ?? "#00ffcc",
    disposition:     opts.disposition   ?? "friendly",
    homeNodeId:      opts.homeNodeId    ?? null,
    currentNodeId:   opts.currentNodeId ?? null,
    currentRez:      null,
    maxRez:          null,
    active:          false,
    targetTokenId:   null,
  };
}

export function createIceToken(iceName, homeNodeId, opts = {}) {
  const stats = BLACK_ICE[iceName] ?? { rez: 10 };
  return {
    id:            generateId(),
    type:          "black_ice",
    name:          iceName,
    iceName:       iceName,
    iconPath:      null,   // optional custom icon override
    homeNodeId:    homeNodeId,
    currentNodeId: homeNodeId,
    currentRez:    stats.rez,
    maxRez:        stats.rez,
    active:        false,
    targetTokenId: null,
    disposition:   opts.disposition ?? "enemy",
    userId:        opts.userId ?? null,  // if set, this user can control this ICE
    isNPC: true, color: "#ff3030",
    ...opts,
  };
}

export function createDemonToken(demonName, homeNodeId, opts = {}) {
  const stats = DEMONS[demonName] ?? { rez: 15 };
  return {
    id:            generateId(),
    type:          "demon",
    name:          demonName,
    demonName:     demonName,
    iconPath:      null,
    homeNodeId:    homeNodeId,
    currentNodeId: homeNodeId,
    currentRez:    stats.rez,
    maxRez:        stats.rez,
    active:        false,
    targetTokenId: null,
    disposition:   opts.disposition ?? "enemy",
    userId:        opts.userId ?? null,
    isNPC: true, color: "#cc44ff",
    ...opts,
  };
}

// ── Run state ─────────────────────────────────────────────────────────────────

export function createRunState(archId) {
  return {
    archId,
    isActive:   true,
    round:      1,
    tokens:     [],     // unified: runners + ICE + demons
    nodeStates: {},     // { nodeId: { revealed, beaten } }
    log:        [{ round:1, text:"Run initialized.", timestamp: Date.now() }],
  };
}

export function initNodeStates(runState, architecture) {
  for (const nodeId of Object.keys(architecture.nodes)) {
    if (!runState.nodeStates[nodeId]) {
      runState.nodeStates[nodeId] = { revealed: false, beaten: false };
    }
  }
}

/**
 * Create tokens from the spawns arrays on architecture nodes.
 * Does NOT reveal the nodes — ICE/demons start hidden.
 */
export function initializeSpawns(runState, architecture) {
  for (const node of Object.values(architecture.nodes)) {
    const spawns = node.data?.spawns ?? [];
    if (!spawns.length) continue;

    for (const spawn of spawns) {
      const disp = spawn.disposition ?? "enemy";
      if (spawn.type === "black_ice" && spawn.iceName) {
        const tok = createIceToken(spawn.iceName, node.id, { currentNodeId: node.id, disposition: disp });
        addToken(runState, tok);
      } else if (spawn.type === "demon" && spawn.demonName) {
        const tok = createDemonToken(spawn.demonName, node.id, { currentNodeId: node.id, disposition: disp });
        addToken(runState, tok);
      }
    }
  }
}

/**
 * Reset the run: clear all tokens, reset all node states, re-run spawns.
 * Runners are removed too — GM must re-add them.
 */
export function resetRun(runState, architecture) {
  runState.tokens     = [];
  runState.nodeStates = {};
  runState.round      = 1;
  runState.log        = [{ round:1, text:"Run reset.", timestamp: Date.now() }];
  initNodeStates(runState, architecture);
  initializeSpawns(runState, architecture);
}

// ── Storage ───────────────────────────────────────────────────────────────────

export function loadRunState() {
  try {
    const raw = game.settings.get(MODULE_ID, "netrun_active_run");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export async function saveRunState(state) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, "netrun_active_run", JSON.stringify(state));
}

export async function clearRunState() {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, "netrun_active_run", "");
}

// ── Token finders ─────────────────────────────────────────────────────────────

export function findRunnerByUser(runState, userId) {
  return runState.tokens?.find(t => t.type === "runner" && t.userId === userId) ?? null;
}

export function findTokenById(runState, tokenId) {
  return runState.tokens?.find(t => t.id === tokenId) ?? null;
}

export function getRunners(runState) {
  return runState.tokens?.filter(t => t.type === "runner") ?? [];
}

export function getIceTokens(runState) {
  return runState.tokens?.filter(t => t.type === "black_ice") ?? [];
}

export function getDemonTokens(runState) {
  return runState.tokens?.filter(t => t.type === "demon") ?? [];
}

// ── Token mutations ───────────────────────────────────────────────────────────

export function addToken(runState, token) {
  if (!runState.tokens) runState.tokens = [];
  runState.tokens.push(token);
  return token;
}

export function removeToken(runState, tokenId) {
  runState.tokens = runState.tokens?.filter(t => t.id !== tokenId) ?? [];
}

export function moveToken(runState, tokenId, nodeId) {
  const tok = findTokenById(runState, tokenId);
  if (tok) tok.currentNodeId = nodeId;
}

export function setTokenRez(runState, tokenId, rez) {
  const tok = findTokenById(runState, tokenId);
  if (!tok) return;
  tok.currentRez = Math.max(0, rez);
  if (tok.currentRez <= 0) {
    tok.active = false;
    tok.targetTokenId = null;
  }
}

export function setTokenActive(runState, tokenId, active, targetTokenId = null) {
  const tok = findTokenById(runState, tokenId);
  if (!tok) return;
  tok.active        = active;
  tok.targetTokenId = active ? targetTokenId : null;
}

// ── Node state mutations ───────────────────────────────────────────────────────

export function revealNode(runState, nodeId) {
  if (!runState.nodeStates[nodeId]) runState.nodeStates[nodeId] = { revealed: false, beaten: false };
  runState.nodeStates[nodeId].revealed = true;
}

export function hideNode(runState, nodeId) {
  if (!runState.nodeStates[nodeId]) runState.nodeStates[nodeId] = { revealed: false, beaten: false };
  runState.nodeStates[nodeId].revealed = false;
}

/**
 * Apply HP/REZ damage to a token. Runners lose HP, ICE/demons lose REZ.
 */
export function applyDamageToToken(runState, tokenId, amount) {
  const tok = findTokenById(runState, tokenId);
  if (!tok) return;
  if (tok.type === "runner") {
    const max = tok.maxHp ?? 20;
    tok.currentHp = Math.max(0, Math.min(max, (tok.currentHp ?? max) - amount));
  } else {
    const max = tok.maxRez ?? tok.currentRez ?? 0;
    const cur = tok.currentRez ?? max;
    setTokenRez(runState, tokenId, Math.max(0, Math.min(max, cur - amount)));
  }
}

export function beatNode(runState, nodeId) {
  if (!runState.nodeStates[nodeId]) runState.nodeStates[nodeId] = { revealed: false, beaten: false };
  runState.nodeStates[nodeId].beaten   = true;
  // Deactivate any ICE that lives here
  for (const tok of runState.tokens ?? []) {
    if (tok.homeNodeId === nodeId) tok.active = false;
  }
}

// ── Visibility helpers ────────────────────────────────────────────────────────
/**
 * Compute visibility state for each node from a player's perspective.
 * Returns a Map<nodeId, "revealed"|"questionmark"|"hidden">
 *
 * - "revealed":     GM explicitly revealed this node
 * - "questionmark": Not revealed, but directly connected to a revealed node
 * - "hidden":       No connection to any revealed node
 *
 * GM sees all nodes; this is used only for player rendering.
 */
export function computeVisibility(architecture, runState) {
  const { nodes, connections = [] } = architecture;
  const ns = runState?.nodeStates ?? {};

  const revealedSet = new Set(
    Object.keys(ns).filter(id => ns[id]?.revealed)
  );

  // Build adjacency
  const adj = new Map();
  for (const [a, b] of connections) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  const result = new Map();
  for (const nodeId of Object.keys(nodes)) {
    if (revealedSet.has(nodeId)) {
      result.set(nodeId, "revealed");
    } else {
      const neighbors = adj.get(nodeId) ?? [];
      const adjacentToRevealed = neighbors.some(nid => revealedSet.has(nid));
      result.set(nodeId, adjacentToRevealed ? "questionmark" : "hidden");
    }
  }
  return result;
}

// ── Log ───────────────────────────────────────────────────────────────────────

export function addLogEntry(runState, text) {
  runState.log = runState.log ?? [];
  runState.log.push({ round: runState.round ?? 1, text, timestamp: Date.now() });
  if (runState.log.length > 100) runState.log.shift();
}
