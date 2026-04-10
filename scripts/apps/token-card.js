/**
 * Unified token detail card (bottom panel).
 */

import { BLACK_ICE, DEMONS } from "../data/node-defs.js";

// ── Inline dice rendering ─────────────────────────────────────────────────────
function inlineRolls(text, labelPrefix = "Roll") {
  if (!text) return "";
  return text.replace(/((?:\d+)?d\d+(?:[+-]\d+)?)/g, (match) => {
    const formula = match.trim().replace(/\s/g, "");
    return `<span class="stat-rollable" data-roll="${formula}" data-label="${labelPrefix}">${match}</span>`;
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function statRow(label, value, rollFormula = null, cls = "") {
  const val = rollFormula
    ? `<span class="stat-val stat-rollable" data-roll="${rollFormula}" data-label="${label}" title="Click to roll">${value}</span>`
    : `<span class="stat-val">${value}</span>`;
  return `<div class="stat-row ${cls}"><span class="stat-lbl">${label}</span>${val}</div>`;
}

function rezBar(cur, max) {
  const pct = max > 0 ? Math.max(0, Math.round(cur / max * 100)) : 0;
  const col = pct > 60 ? "#ff3030" : pct > 30 ? "#ff8800" : "#ffff00";
  return `<div class="card-rez-wrap">
    <div class="card-rez-bar"><div class="card-rez-fill" style="width:${pct}%;background:${col}"></div></div>
    <span class="card-rez-txt">${cur} / ${max}</span>
  </div>`;
}

function moveRow() {
  return `<div class="tcard-move-row">
    <button class="tcard-btn btn-move-dir" data-dir="up"    title="Move Up">↑</button>
    <button class="tcard-btn btn-move-dir" data-dir="left"  title="Move Left">←</button>
    <span class="tcard-move-lbl">MOVE</span>
    <button class="tcard-btn btn-move-dir" data-dir="right" title="Move Right">→</button>
    <button class="tcard-btn btn-move-dir" data-dir="down"  title="Move Down">↓</button>
  </div>`;
}

// ── Runner card ───────────────────────────────────────────────────────────────
function renderRunnerCard(tok, isGM) {
  const interfaceRank = tok.interfaceRank ?? 4;
  // codingRank: show only when it's explicitly set and differs from interfaceRank
  const codingRank    = tok.codingRank ?? null;
  const showCoding    = codingRank !== null && codingRank !== interfaceRank;

  return `<div class="tcard tcard-runner" style="--tc:${tok.color}">
    <div class="tcard-header">
      <div class="tcard-dot" style="background:${tok.color}"></div>
      <div class="tcard-name">${tok.name}</div>
      ${tok.isNPC ? '<span class="tcard-badge">NPC</span>' : ''}
      ${tok.actorId ? '<span class="tcard-badge" title="Linked to actor">⚙</span>' : ''}
      ${isGM ? `<button class="tcard-btn btn-edit-token-rez">REZ</button>
                <button class="tcard-btn btn-token-reset-home">⌂</button>
                <button class="tcard-btn btn-edit-token-meta" title="Edit name/icon">✎</button>` : ""}
    </div>
    <div class="tcard-body">
      ${statRow("Interface", interfaceRank, `1d10 + ${interfaceRank}`, "stat-highlight")}
      ${showCoding ? statRow("Coding", codingRank, `1d10 + ${codingRank}`) : ""}
      ${statRow("NET Actions", `${tok.netActionsUsed}/${tok.netActionsTotal}`)}
      ${statRow("HP", `${tok.currentHp ?? tok.maxHp ?? 40} / ${tok.maxHp ?? 40}`, null,
                (tok.currentHp ?? tok.maxHp ?? 40) < (tok.maxHp ?? 40) * 0.4 ? "stat-danger" : "")}
      ${statRow("Disposition", (tok.disposition ?? "friendly").toUpperCase())}
    </div>
    ${isGM ? moveRow() : ""}
  </div>`;
}

// ── ICE card ──────────────────────────────────────────────────────────────────
function renderIceCard(tok, isGM) {
  const stats  = BLACK_ICE[tok.iceName] ?? {};
  const cur    = tok.currentRez ?? stats.rez ?? 0;
  const max    = tok.maxRez     ?? stats.rez ?? 0;

  const effectHtml = inlineRolls(stats.effect ?? "", tok.iceName);

  return `<div class="tcard tcard-ice ${tok.active ? "tcard-active" : ""}" style="--tc:#ff3030">
    <div class="tcard-header">
      <div class="tcard-dot" style="background:#ff3030"></div>
      <div class="tcard-name">${tok.iceName ?? tok.name}</div>
      <span class="tcard-badge tcard-badge-ice">${stats.class ?? "ICE"}</span>
      ${isGM ? `<button class="tcard-btn btn-token-active ${tok.active ? "btn-active-on" : ""}">
                  ${tok.active ? "DEACTIVATE" : "ACTIVATE"}</button>
                <button class="tcard-btn btn-edit-token-rez">REZ</button>
                <button class="tcard-btn btn-token-reset-home">⌂</button>
                <button class="tcard-btn btn-edit-token-meta" title="Edit name/icon">✎</button>` : ""}
    </div>
    ${rezBar(cur, max)}
    <div class="tcard-body tcard-ice-stats">
      ${stats.per !== undefined ? `
        ${statRow("PER", stats.per, `1d10 + ${stats.per}`)}
        ${statRow("SPD", stats.spd, `1d10 + ${stats.spd}`)}
        ${statRow("ATK", stats.atk, `1d10 + ${stats.atk}`)}
        ${statRow("DEF", stats.def, `1d10 + ${stats.def}`)}
      ` : ""}
      ${stats.effect ? `<div class="tcard-effect">${effectHtml}</div>` : ""}
      ${stats.damage ? `<div class="tcard-damage-badge stat-rollable"
            data-roll="${stats.damage.formula}"
            data-label="${tok.iceName ?? "ICE"} Damage"
            data-damage-type="${stats.damage.type}"
            title="Click to roll damage: ${stats.damage.formula}">
        DAMAGE: ${stats.damage.formula}
      </div>` : ""}
    </div>
    ${isGM ? moveRow() : ""}
  </div>`;
}

// ── Demon card ────────────────────────────────────────────────────────────────
function renderDemonCard(tok, isGM) {
  const stats = DEMONS[tok.demonName] ?? {};
  const cur   = tok.currentRez ?? stats.rez ?? 0;
  const max   = tok.maxRez     ?? stats.rez ?? 0;
  const iface = stats.interface ?? 4;

  return `<div class="tcard tcard-demon ${tok.active ? "tcard-active" : ""}" style="--tc:#cc44ff">
    <div class="tcard-header">
      <div class="tcard-dot" style="background:#cc44ff"></div>
      <div class="tcard-name">${tok.demonName ?? tok.name}</div>
      <span class="tcard-badge tcard-badge-demon">DEMON</span>
      ${isGM ? `<button class="tcard-btn btn-token-active ${tok.active ? "btn-active-on" : ""}">
                  ${tok.active ? "DEACTIVATE" : "ACTIVATE"}</button>
                <button class="tcard-btn btn-edit-token-rez">REZ</button>
                <button class="tcard-btn btn-token-reset-home">⌂</button>
                <button class="tcard-btn btn-edit-token-meta" title="Edit name/icon">✎</button>` : ""}
    </div>
    ${rezBar(cur, max)}
    <div class="tcard-body">
      ${statRow("Interface", iface, `1d10 + ${iface}`, "stat-highlight")}
      ${statRow("NET Actions", stats.netActions ?? 2)}
      ${statRow("Combat #",    stats.combatNum  ?? 14, `1d10 + ${iface}`)}
    </div>
    ${isGM ? moveRow() : ""}
  </div>`;
}

// ── Entry point ───────────────────────────────────────────────────────────────
export function renderTokenCard(tok, isGM) {
  if (!tok) return "";
  switch (tok.type) {
    case "runner":    return renderRunnerCard(tok, isGM);
    case "black_ice": return renderIceCard(tok, isGM);
    case "demon":     return renderDemonCard(tok, isGM);
    default:          return "";
  }
}
