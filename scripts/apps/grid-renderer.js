/**
 * grid-renderer.js
 * Shared grid renderer — 160px nodes, 36px connectors.
 *
 * Visibility model (player view):
 *   "revealed"     — GM revealed; shown normally
 *   "questionmark" — adjacent to a revealed node; shown as "?" tile
 *   "hidden"       — no revealed neighbour; not rendered at all for player
 *
 * GM always sees all nodes with small status badges:
 *   green dot  = revealed to players
 *   ? badge    = shown as questionmark to players
 *   grey dot   = hidden from players
 *
 * Tokens (runners, ICE, demons) are drawn from runState.tokens
 * based on each token's currentNodeId.
 */

import { getNodeDisplayLabel, getNodeTileUrl } from "../data/architecture.js";
import { BLACK_ICE, DEMONS, NODE_TYPES, getTokenIconPath, getNodeTypeIconPath } from "../data/node-defs.js";
import { computeVisibility } from "../data/run-state.js";
import { escHtml } from "../utils.js";

export const NODE_PX = 160;
export const CONN_PX = 36;

// ── Entry ─────────────────────────────────────────────────────────────────────
export function renderArchGrid(arch, opts = {}) {
  const {
    runState       = null,
    tilesRoot      = "",
    isGM           = false,
    isEditor       = false,
    selectedNodeId = null,
    selectedTokenId = null,
    targetedTokenIds = new Set(),
  } = opts;

  const { nodes, connections = [], gridWidth, gridHeight, entryNodeId } = arch;

  // Position → node
  const posMap = new Map();
  for (const node of Object.values(nodes)) {
    posMap.set(`${node.col},${node.row}`, node);
  }

  // Connection set
  const connSet = new Set(connections.map(([a, b]) => `${a}|${b}`));
  const isConn  = (a, b) => connSet.has(`${a}|${b}`) || connSet.has(`${b}|${a}`);

  // Visibility map for player (and GM indicator badges)
  const visMap = (isGM || isEditor)
    ? null  // GM/editor sees everything
    : computeVisibility(arch, runState);

  // Tokens per visual node (currentNodeId → [{token}])
  const tokensAt = new Map();
  for (const tok of runState?.tokens ?? []) {
    if (!tok.currentNodeId) continue;
    const list = tokensAt.get(tok.currentNodeId) ?? [];
    list.push(tok);
    tokensAt.set(tok.currentNodeId, list);
  }

  // Grid template
  const colParts = [];
  for (let c = 0; c < gridWidth; c++) {
    colParts.push(`${NODE_PX}px`);
    if (c < gridWidth - 1) colParts.push(`${CONN_PX}px`);
  }
  const colTemplate = colParts.join(" ");
  const visualCols  = gridWidth  * 2 - 1;
  const visualRows  = gridHeight * 2 - 1;

  let html = `<div class="arch-grid${isEditor ? " editor-grid" : ""}" `
    + `style="grid-template-columns:${colTemplate};grid-template-rows:${colTemplate}">`;

  for (let vr = 0; vr < visualRows; vr++) {
    const isNodeRow = vr % 2 === 0;
    const nodeRow   = vr >> 1;
    for (let vc = 0; vc < visualCols; vc++) {
      const isNodeCol = vc % 2 === 0;
      const nodeCol   = vc >> 1;

      if (isNodeRow && isNodeCol) {
        const node   = posMap.get(`${nodeCol},${nodeRow}`) ?? null;
        const tokens = node ? (tokensAt.get(node.id) ?? []) : [];
        const vis    = node ? (visMap?.get(node.id) ?? "revealed") : null;

        // Player: skip fully hidden nodes
        if (!isGM && !isEditor && node && vis === "hidden") {
          html += `<div class="arch-cell arch-cell-void"></div>`;
        } else {
          html += _nodeCell(node, nodeCol, nodeRow, {
            tilesRoot, selectedNodeId, selectedTokenId, entryNodeId, tokens,
            isEditor, isGM, runState, vis, targetedTokenIds // <-- 2. Pass it down
          });
        }

      } else if (isNodeRow && !isNodeCol) {
        const L = posMap.get(`${nodeCol},${nodeRow}`);
        const R = posMap.get(`${nodeCol+1},${nodeRow}`);
        // Connectors only shown if both sides are visible to player
        const lv = visMap?.get(L?.id) ?? "revealed";
        const rv = visMap?.get(R?.id) ?? "revealed";
        const skip = !isGM && !isEditor && (lv === "hidden" || rv === "hidden");
        if (skip) {
          html += `<div class="arch-cell arch-hconn"></div>`;
        } else {
          const connected = !!(L && R && isConn(L.id, R.id));
          html += _hConn(L, R, connected, isEditor);
        }

      } else if (!isNodeRow && isNodeCol) {
        const T = posMap.get(`${nodeCol},${nodeRow}`);
        const B = posMap.get(`${nodeCol},${nodeRow+1}`);
        const tv = visMap?.get(T?.id) ?? "revealed";
        const bv = visMap?.get(B?.id) ?? "revealed";
        const skip = !isGM && !isEditor && (tv === "hidden" || bv === "hidden");
        if (skip) {
          html += `<div class="arch-cell arch-vconn"></div>`;
        } else {
          const connected = !!(T && B && isConn(T.id, B.id));
          html += _vConn(T, B, connected, isEditor);
        }

      } else {
        html += `<div class="arch-cell arch-corner"></div>`;
      }
    }
  }

  html += `</div>`;
  return html;
}

// ── Node cell ─────────────────────────────────────────────────────────────────
function _nodeCell(node, col, row, opts) {
  const { tilesRoot, selectedNodeId, selectedTokenId, entryNodeId, tokens,
          isEditor, isGM, runState, vis, targetedTokenIds } = opts;

  if (!node) {
    if (isEditor) {
      return `<div class="arch-cell arch-cell-empty editor-addable"
                   data-action="add-node" data-col="${col}" data-row="${row}">
        <div class="empty-cell-hint">+</div></div>`;
    }
    return `<div class="arch-cell arch-cell-void"></div>`;
  }

  const ns      = runState?.nodeStates?.[node.id] ?? {};
  const beaten  = ns.beaten  ?? false;
  // Effective visibility for THIS user
  const showFull = isGM || isEditor || vis === "revealed";
  const showQ    = !showFull && vis === "questionmark";

  const isSelected = node.id === selectedNodeId;
  const isEntry    = node.id === entryNodeId;
  const typeInfo   = NODE_TYPES[node.type] ?? { color:"#888" };

  const label      = showFull ? getNodeDisplayLabel(node) : (showQ ? "???" : "");
  const subtitle   = showFull ? (node.subtitle ?? "") : "";
  const tileUrl    = showFull ? getNodeTileUrl(node, tilesRoot) : null;
  const typeIconUrl = showFull ? getNodeTypeIconPath(tilesRoot, node.type, node.data) : null;

  const classes = [
    "arch-cell", "arch-node",
    `node-type-${node.type}`,
    isSelected ? "node-selected" : "",
    beaten     ? "node-beaten"   : "",
    showQ      ? "node-qmark"    : "",
    isEntry    ? "node-entry"    : "",
    isEditor   ? "node-editable" : "",
  ].filter(Boolean).join(" ");

  let inner = "";

  // Floor tile or ? or void background
  if (showFull && tileUrl) {
    inner += `<img class="node-tile-bg" src="${tileUrl}" alt="${escHtml(label)}" draggable="false"/>`;
  } else if (showQ) {
    inner += `<div class="node-tile-bg node-tile-qmark"><span>?</span></div>`;
  } else {
    inner += `<div class="node-tile-bg node-tile-unknown"><span>?</span></div>`;
  }

  // GM visibility badge (top-left)
  if (isGM && !isEditor) {
    const badgeCls = ns.revealed ? "vis-badge vis-revealed" :
                     vis === "questionmark" ? "vis-badge vis-qmark" : "vis-badge vis-hidden";
    const badgeTip = ns.revealed ? "Revealed to players" :
                     vis === "questionmark" ? "Players see ? (adjacent to revealed)" : "Hidden from players";
    inner += `<div class="${badgeCls}" title="${badgeTip}"></div>`;
  }

  // Type icon badge (top-right)
  if (showFull && typeIconUrl && node.type !== "empty") {
    inner += `<img class="node-type-icon" src="${typeIconUrl}" alt="${node.type}" draggable="false"/>`;
  }

  // Entry badge
  if (isEntry) {
    inner += `<div class="node-entry-badge">ENTRY</div>`;
  }

  // Tokens — drawn if at least the node is questionmark (runners shown, ICE tokens only if revealed)
  if (tokens.length && (showFull || showQ)) {
    const visibleTokens = showFull ? tokens : tokens.filter(t => t.type === "runner");
    if (visibleTokens.length) {
      inner += `<div class="node-tokens">`;
      for (const tok of visibleTokens) {
        const isTargeted = targetedTokenIds?.has(tok.id) ?? false;
        inner += _token(tok, tilesRoot, tok.id === selectedTokenId, isTargeted);
      }
      inner += `</div>`;
    }
  }

  // GM notes indicator (small badge, GM-only)
  if ((isGM || isEditor) && node.gmNotes) {
    inner += `<div class="node-gmnotes-badge" title="${escHtml(node.gmNotes)}">📝</div>`;
  }

  // Labels
  if (label || subtitle) {
    inner += `<div class="node-labels">`;
    if (label)    inner += `<div class="node-label">${escHtml(label)}</div>`;
    if (subtitle) inner += `<div class="node-subtitle">${escHtml(subtitle)}</div>`;
    inner += `</div>`;
  }

  // Editor controls
  if (isEditor) {
    inner += `<button class="node-btn node-del-btn"   data-action="delete-node" data-node-id="${node.id}" title="Delete">✕</button>`;
    if (!isEntry) inner += `<button class="node-btn node-entry-btn" data-action="set-entry" data-node-id="${node.id}" title="Set entry">⊕</button>`;
  }

  return `<div class="${classes}" data-node-id="${node.id}" data-col="${col}" data-row="${row}"
               style="--node-color:${typeInfo.color}">${inner}</div>`;
}

// ── Token cell ────────────────────────────────────────────────────────────────
function _token(tok, tilesRoot, isSelected = false, isTargeted = false) {
  let imgSrc, colorVar;
  if (tok.type === "runner" || tok.type === "npc") {
    imgSrc   = tok.iconPath || getTokenIconPath(tilesRoot, tok.isNPC ? "npc" : "netrunner", "");
    colorVar = tok.color ?? "#00ffcc";
  } else if (tok.type === "black_ice") {
    imgSrc   = tok.iconPath || getTokenIconPath(tilesRoot, "black_ice", tok.iceName ?? "BLACKICE");
    colorVar = tok.active ? "#ff3030" : "#884444";
  } else if (tok.type === "demon") {
    imgSrc   = tok.iconPath || getTokenIconPath(tilesRoot, "demon", tok.demonName ?? "DEMON");
    colorVar = "#cc44ff";
  } else {
    return "";
  }

  // REZ bar for ICE/Demon
  let rezBar = "";
  if ((tok.type === "black_ice" || tok.type === "demon") && tok.maxRez) {
    const cur = tok.currentRez ?? tok.maxRez;
    const pct = Math.max(0, Math.round(cur / tok.maxRez * 100));
    const col = pct > 60 ? "#ff3030" : pct > 30 ? "#ff8800" : "#ffff00";
    rezBar = `<div class="token-rez-bar">
      <div class="token-rez-fill" style="width:${pct}%;background:${col}"></div>
    </div>`;
  }

  const activeClass = tok.active    ? " token-active"    : "";
  const selClass    = isSelected    ? " token-selected"   : "";
  const targClass   = isTargeted    ? " token-targeted"   : "";
  const disp        = tok.disposition ?? (tok.type === "runner" ? "friendly" : "enemy");
  const dispClass   = ` tok-disp-${disp}`;
  const cls = `token token-${tok.type}${activeClass}${selClass}${targClass}${dispClass}`;

  const isOwned = tok.userId === (typeof game !== "undefined" ? game.userId : "");
  return `<div class="${cls}" data-token-id="${tok.id}" data-owned="${isOwned}"
               style="--tok-color:${colorVar};--disp-color:${_dispColor(disp)}"
               title="${escHtml(tok.name)}">
    <div class="token-img-wrap">
      <img src="${imgSrc}" alt="${escHtml(tok.name)}"/>
      ${isTargeted ? '<div class="token-target-ring"></div>' : ''}
    </div>
    ${rezBar}
    <span class="token-name">${escHtml(tok.name)}</span>
  </div>`;
}

// ── Connectors ────────────────────────────────────────────────────────────────
function _hConn(L, R, connected, isEditor) {
  const cls = connected ? "conn-active" : "";
  if (isEditor && L && R) {
    const btnCls = connected ? "conn-btn conn-on" : "conn-btn conn-off";
    return `<div class="arch-cell arch-hconn ${cls}" data-action="toggle-conn"
                 data-node-a="${L.id}" data-node-b="${R.id}">
      <div class="${btnCls}">↔</div></div>`;
  }
  return `<div class="arch-cell arch-hconn ${cls}">
    ${connected ? '<div class="conn-line conn-h"></div>' : ""}</div>`;
}

function _vConn(T, B, connected, isEditor) {
  const cls = connected ? "conn-active" : "";
  if (isEditor && T && B) {
    const btnCls = connected ? "conn-btn conn-on" : "conn-btn conn-off";
    return `<div class="arch-cell arch-vconn ${cls}" data-action="toggle-conn"
                 data-node-a="${T.id}" data-node-b="${B.id}">
      <div class="${btnCls}">↕</div></div>`;
  }
  return `<div class="arch-cell arch-vconn ${cls}">
    ${connected ? '<div class="conn-line conn-v"></div>' : ""}</div>`;
}

function _dispColor(disp) {
  if (disp === "friendly") return "#4488ff";
  if (disp === "neutral")  return "#ffaa00";
  return "#ff3030";
}