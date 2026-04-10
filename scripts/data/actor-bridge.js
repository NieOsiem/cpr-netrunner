/**
 * actor-bridge.js
 * All knowledge of the CPR system's actor data model lives here.
 * If CPR ever changes data paths, this is the only file to update.
 *
 * Confirmed data paths (cyberpunk-red-core, Foundry 12, script output 2025):
 *   Interface rank : roleItem.system.rank
 *                    where roleItem = actor.items[type==="role" && mainRoleAbility==="Interface"]
 *   Coding rank    : roleItem.system.abilities[n].rank  (ability name "Coding")
 *                    fallback: max(1, interfaceRank + actor.system.stats.int.value - 7)
 *   HP current     : actor.system.derivedStats.hp.value
 *   HP max         : actor.system.derivedStats.hp.max
 *   Icon           : actor.img  (avatar — reliable; prototypeToken.texture.src may contain wildcards)
 *   Token name     : actor.prototypeToken.name || actor.name
 *   Color          : game.users.find linked to actor → user.color.css
 */

const FALLBACK_INTERFACE = 4;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _getRoleItem(actor) {
  return actor?.items?.find(i => i.type === "role" && i.system?.mainRoleAbility === "Interface") ?? null;
}

function _getInterfaceRank(roleItem) {
  return roleItem?.system?.rank ?? FALLBACK_INTERFACE;
}

function _getCodingRank(roleItem, interfaceRank, actor) {
  // 1. Explicit Coding ability stored inside the role item
  const codingAbility = roleItem?.system?.abilities?.find(a => a.name === "Coding");
  if (codingAbility?.rank != null) return codingAbility.rank;
  // 2. Homebrew formula: Interface + INT - 7 (min 1)
  const intVal = actor?.system?.stats?.int?.value;
  if (intVal != null) return Math.max(1, interfaceRank + intVal - 7);
  // 3. Last resort: treat as equal to Interface
  return interfaceRank;
}

function _getLinkedUserColor(actorId) {
  const user = game.users?.find(u => u.character?.id === actorId);
  // user.color may be a Color object (has .css) or already a string
  return user?.color?.css ?? (typeof user?.color === "string" ? user.color : null) ?? "#00ffcc";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract all netrun-relevant stats from a CPR actor.
 * Always returns a complete object — never throws.
 *
 * @param {Actor} actor
 * @returns {{
 *   interfaceRank: number,
 *   codingRank:    number,
 *   hpMax:         number,
 *   hpCurrent:     number,
 *   iconPath:      string|null,
 *   name:          string,
 *   color:         string,
 * }}
 */
export function extractActorStats(actor) {
  try {
    const roleItem      = _getRoleItem(actor);
    const interfaceRank = _getInterfaceRank(roleItem);
    const codingRank    = _getCodingRank(roleItem, interfaceRank, actor);
    const hp            = actor.system?.derivedStats?.hp ?? {};

    return {
      interfaceRank,
      codingRank,
      hpMax:     hp.max   ?? 40,
      hpCurrent: hp.value ?? hp.max ?? 40,
      iconPath:  actor.img ?? null,
      name:      actor.prototypeToken?.name || actor.name,
      color:     _getLinkedUserColor(actor.id),
    };
  } catch (err) {
    console.warn("CPR Netrunner | extractActorStats failed:", err);
    return {
      interfaceRank: FALLBACK_INTERFACE,
      codingRank:    FALLBACK_INTERFACE,
      hpMax:         40,
      hpCurrent:     40,
      iconPath:      null,
      name:          actor?.name ?? "Runner",
      color:         "#00ffcc",
    };
  }
}

/**
 * Return the actor linked to a Foundry user as their character, or null.
 *
 * @param {string} userId
 * @returns {Actor|null}
 */
export function actorFromUser(userId) {
  return game.users?.get(userId)?.character ?? null;
}

/**
 * Return the actor from the first currently-controlled canvas token, or null.
 * Only meaningful in a GM context (players typically control their own token).
 *
 * @returns {Actor|null}
 */
export function actorFromSelectedToken() {
  return canvas.tokens?.controlled[0]?.actor ?? null;
}

/**
 * Write a new HP current value directly to a linked actor (GM only).
 * Silently no-ops if the actor cannot be found, isn't owned, or the
 * caller is not the GM.
 *
 * @param {string} actorId   - Foundry actor id
 * @param {number} hpValue   - New HP value (will be clamped to ≥ 0)
 */
export async function writeHpToActor(actorId, hpValue) {
  if (!game.user?.isGM) return;
  const actor = game.actors?.get(actorId);
  if (!actor?.isOwner) return;
  try {
    await actor.update({ "system.derivedStats.hp.value": Math.max(0, hpValue) });
  } catch (err) {
    console.warn("CPR Netrunner | writeHpToActor failed:", err);
  }
}
