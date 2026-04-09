/**
 * utils.js — Shared helpers.
 */

export const MODULE_ID = "cpr-netrunner";

export function getTilesRoot() {
  try { return game.settings.get(MODULE_ID, "tilesRoot"); }
  catch { return "S/Prefaby/NetrunningTilesV2"; }
}

export function getSetting(key, fallback = null) {
  try { return game.settings.get(MODULE_ID, key); }
  catch { return fallback; }
}

/** Returns true if the current user is a GM. */
export function isGM() { return game.user.isGM; }
export function isCurrentUser(userId) { return game.userId === userId; }
export function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

export function debounce(fn, delay = 200) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

export function darkenColor(hex, factor = 0.6) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgb(${Math.round(r*factor)},${Math.round(g*factor)},${Math.round(b*factor)})`;
}

// ── CPR Exploding d10 Roll ─────────────────────────────────────────────────────
/**
 * Roll to chat. Detects "1d10 + N" pattern and applies CPR exploding d10 rules:
 *   Roll 10 → roll another d10 and ADD
 *   Roll  1 → roll another d10 and SUBTRACT
 *
 * Format: "d10[10] + d10[4] + 2"  or  "d10[1] - d10[6] + 5"
 *
 * opts.isDamage = true → tag the message so targeted tokens can receive damage.
 * opts.targetedTokenIds = [...] → if set and isDamage, send a follow-up GM-only
 *   message with apply-damage buttons.
 *
 * Returns { total, isDamage, formula } for callers that care.
 */
export async function rollToChat(formula, label = "", opts = {}) {
  const { isDamage = false, damageType = null } = opts;

  // Detect CPR interface roll: "1d10 + N"
  const cprMatch = formula.match(/^1d10\s*[+]\s*(-?\d+)$/);
  if (cprMatch) {
    return _cprD10Roll(parseInt(cprMatch[1]), label, { isDamage, damageType });
  }

  // Plain Foundry roll (e.g. "2d6" for ICE effects)
  return _plainRoll(formula, label, { isDamage, damageType });
}

// ── CPR d10 (exploding) ───────────────────────────────────────────────────────
async function _cprD10Roll(modifier, label, opts) {
  const { isDamage } = opts;

  const base = new Roll("1d10");
  await base.evaluate();
  const baseVal = base.total;

  let total = baseVal + modifier;
  let critVal = null;
  let critDir = null;  // "add" | "sub"

  if (baseVal === 10) {
    const crit = new Roll("1d10");
    await crit.evaluate({ async: true });
    critVal  = crit.total;
    total   += critVal;
    critDir  = "add";
  } else if (baseVal === 1) {
    const crit = new Roll("1d10");
    await crit.evaluate({ async: true });
    critVal  = crit.total;
    total   -= critVal;
    critDir  = "sub";
  }

  // Build single formula line
  const modStr = modifier >= 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`;
  let formulaLine = `d10[${baseVal}]`;
  if (critDir === "add") formulaLine += ` + d10[${critVal}]`;
  if (critDir === "sub") formulaLine += ` - d10[${critVal}]`;
  formulaLine += ` ${modStr}`;

  const critLine = critDir === "add"
    ? `<div class="cpr-crit cpr-crit-hit">CRITICAL HIT</div>`
    : critDir === "sub"
    ? `<div class="cpr-crit cpr-crit-miss">CRITICAL FUMBLE</div>`
    : "";

  const totalColor = total >= 14 ? "#00ff88" : total >= 10 ? "#ffdd44" : "#ff6644";
  const content = `
    <div class="cpr-net-roll">
      <div class="cpr-roll-label">${escHtml(label)}</div>
      <div class="cpr-roll-formula">${formulaLine}</div>
      ${critLine}
      <div class="cpr-roll-total" style="color:${totalColor}">${total}</div>
    </div>`;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker(),
    flags: { [MODULE_ID]: { roll:{ type:"cpr-d10", base:baseVal, modifier, critDir, critVal, total } } },
  });

  return { total, isDamage };
}

// ── Plain roll (2d6, 6d6, etc.) ───────────────────────────────────────────────
async function _plainRoll(formula, label, opts) {
  const { isDamage } = opts;

  const roll = new Roll(formula);
  await roll.evaluate();
  const total = roll.total;

  // Format dice results: "2d6[3,5]" style
  const diceStr = roll.dice.map(d => {
    const faces = d.results.map(r => r.result).join(",");
    return `${d.number}d${d.faces}[${faces}]`;
  }).join(" + ");

  const totalColor = "#ffdd44";
  const content = `
    <div class="cpr-net-roll">
      <div class="cpr-roll-label">${escHtml(label)}</div>
      <div class="cpr-roll-formula">${diceStr}</div>
      <div class="cpr-roll-total" style="color:${totalColor}">${total}</div>
    </div>`;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker(),
    flags: { [MODULE_ID]: { roll:{ type:"plain", formula, total } } },
  });

  return { total, isDamage };
}

// ── Damage application follow-up message ──────────────────────────────────────
export async function sendDamageCard(amount, sourceLabel, damageType, tokenInfos) {
  if (!tokenInfos?.length || !game.user.isGM) return;

  const typeLabel = damageType === "brain"   ? "Brain Damage"
                  : damageType === "program" ? "REZ Damage"
                  : damageType === "stat"    ? "Stat Damage"
                  : "Damage";

  const buttons = tokenInfos.map(t =>
    `<span class="cpr-dmg-pair">
       <button class="cpr-dmg-btn" data-token-id="${t.id}" data-amount="${amount}">
         −${amount} to ${escHtml(t.name)}
       </button>
       <button class="cpr-dmg-btn cpr-undo-btn" data-token-id="${t.id}" data-amount="${-amount}">
         ↩ undo
       </button>
     </span>`
  ).join("");

  const content = `
    <div class="cpr-damage-card">
      <div class="cpr-dmg-header">${typeLabel}: ${amount} from ${escHtml(sourceLabel)}</div>
      <div class="cpr-dmg-buttons">${buttons}</div>
    </div>`;

  await ChatMessage.create({
    content,
    whisper: [game.userId],
    speaker: ChatMessage.getSpeaker(),
  });
}

export async function sendToChat(content, options = {}) {
  return ChatMessage.create({ content, speaker: ChatMessage.getSpeaker(), ...options });
}

/** HTML-escape a value for safe insertion into attribute values and text content. */
export function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
