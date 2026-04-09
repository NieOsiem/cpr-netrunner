/**
 * node-defs.js
 * CPR entity statblocks, node types, and path resolution.
 *
 * BLACK_ICE can be extended/overridden at runtime via the "customBlackIce"
 * TODO: add this for demons
 * TODO: add option for specific custom image instead of just tileFolder
 * world setting (JSON). On module ready, loadCustomBlackIce() merges it in.
 */

// ── Node Types ─────────────────────────────────────────────────────────────────
export const NODE_TYPES = {
  black_ice:    { label: "Black ICE",    color: "#ff3030" },
  password:     { label: "Password",     color: "#4488ff" },
  file:         { label: "File",         color: "#44ff88" },
  control_node: { label: "Control Node", color: "#ffaa00" },
  system:       { label: "System / Root",color: "#00aaff" },
  empty:        { label: "Empty Node",   color: "#445566" },
  demon:        { label: "Demon",        color: "#cc44ff" },
};

// ── Black ICE ─────────────────────────────────────────────────────────────────
// damage: { formula, type }
//   type "brain"   — damage applied to a runner's HP / brain damage track
//   type "program" — damage applied to a program's REZ
//   type "stat"    — debuff to INT/REF/DEX (still useful to flag for display)
export const BLACK_ICE = {
  Asp:       { per:4, spd:6, atk:2, def:2, rez:15, class:"Anti-Personnel",
               effect:"Destroy random Program",
               tileFolder:"ASP" },
  Giant:     { per:2, spd:2, atk:8, def:4, rez:25, class:"Anti-Personnel",
               effect:"3d6 brain + unsafe Jack Out + all Rezzed enemy Black ICE effects",
               damage:{ formula:"3d6", type:"brain" },
               tileFolder:"GIANT" },
  Hellhound: { per:6, spd:6, atk:6, def:2, rez:20, class:"Anti-Personnel",
               effect:"2d6 brain + fire (2 HP/turn until Meat Action extinguishes)",
               damage:{ formula:"2d6", type:"brain" },
               tileFolder:"HELLHOUND" },
  Kraken:    { per:6, spd:2, atk:8, def:4, rez:30, class:"Anti-Personnel",
               effect:"3d6 brain + block progress/safe Jack Out until end of next Turn",
               damage:{ formula:"3d6", type:"brain" },
               tileFolder:"KRAKEN" },
  Liche:     { per:8, spd:2, atk:6, def:2, rez:25, class:"Anti-Personnel",
               effect:"INT/REF/DEX -1d6 (min 1) for 1 hour",
               damage:{ formula:"1d6", type:"stat" },
               tileFolder:"LICHE" },
  Raven:     { per:6, spd:4, atk:4, def:2, rez:15, class:"Anti-Personnel",
               effect:"Derezz random Defender + 1d6 brain",
               damage:{ formula:"1d6", type:"brain" },
               tileFolder:"RAVEN" },
  Scorpion:  { per:2, spd:6, atk:2, def:2, rez:15, class:"Anti-Personnel",
               effect:"MOVE -1d6 (min 1) for 1 hour",
               damage:{ formula:"1d6", type:"stat" },
               tileFolder:"SCORPION" },
  Skunk:     { per:2, spd:4, atk:4, def:2, rez:10, class:"Anti-Personnel",
               effect:"Slide Checks -2 (stacks)",
               tileFolder:"SKUNK" },
  Wisp:      { per:4, spd:4, atk:4, def:2, rez:15, class:"Anti-Personnel",
               effect:"1d6 brain + -1 NET Actions next Turn (min 2)",
               damage:{ formula:"1d6", type:"brain" },
               tileFolder:"WISP" },
  Dragon:    { per:6, spd:4, atk:6, def:6, rez:30, class:"Anti-Program",
               effect:"6d6 REZ to Program (Destroy if enough to Derezz)",
               damage:{ formula:"6d6", type:"program" },
               tileFolder:"DRAGON" },
  Killer:    { per:4, spd:8, atk:6, def:2, rez:20, class:"Anti-Program",
               effect:"4d6 REZ to Program (Destroy if enough to Derezz)",
               damage:{ formula:"4d6", type:"program" },
               tileFolder:"KILLER" },
  Sabertooth:{ per:8, spd:6, atk:6, def:2, rez:25, class:"Anti-Program",
               effect:"6d6 REZ to Program (Destroy if enough to Derezz)",
               damage:{ formula:"6d6", type:"program" },
               tileFolder:"SABERTOOTH" },
};

/**
 * Merge custom ICE from the world setting into BLACK_ICE at runtime.
 * Call once on module ready.
 */
export function loadCustomBlackIce() {
  try {
    const raw = game.settings.get("cpr-netrunner", "customBlackIce");
    if (!raw || raw.trim() === "" || raw.trim() === "{}") return;
    const custom = JSON.parse(raw);
    for (const [name, stats] of Object.entries(custom)) {
      BLACK_ICE[name] = { ...(BLACK_ICE[name] ?? {}), ...stats };
    }
    console.log(`CPR Netrunner | Loaded ${Object.keys(custom).length} custom Black ICE entries.`);
  } catch (e) {
    console.warn("CPR Netrunner | Failed to parse customBlackIce setting:", e);
    ui.notifications?.warn("CPR Netrunner | Custom Black ICE JSON is invalid — check Module Settings.");
  }
}

// ── Demons ────────────────────────────────────────────────────────────────────
export const DEMONS = {
  Imp:    { rez:15, interface:3, netActions:2, combatNum:14, tileFolder:"IMP" },
  Efreet: { rez:25, interface:4, netActions:3, combatNum:14, tileFolder:"EFREET" },
  Balron: { rez:30, interface:7, netActions:4, combatNum:14, tileFolder:"BALRON" },
};

// ── Programs ──────────────────────────────────────────────────────────────────
export const PROGRAMS = {
  Eraser:         { class:"Booster",        atk:0, def:0, rez:7, effect:"+2 Cloak Checks" },
  SeeYa:          { class:"Booster",        atk:0, def:0, rez:7, effect:"+2 Pathfinder Checks" },
  SpeedyGonzalvez:{ class:"Booster",        atk:0, def:0, rez:7, effect:"+2 Speed" },
  Worm:           { class:"Booster",        atk:0, def:0, rez:7, effect:"+2 Backdoor Checks" },
  Armor:          { class:"Defender",       atk:0, def:0, rez:7, effect:"-4 brain damage (once/Netrun)" },
  Flak:           { class:"Defender",       atk:0, def:0, rez:7, effect:"Non-Black ICE ATK=0 (once/Netrun)" },
  Shield:         { class:"Defender",       atk:0, def:0, rez:7, effect:"Blocks first Non-Black brain damage, then Derezzes" },
  Banhammer:      { class:"Anti-Program",   atk:1, def:0, rez:0, effect:"3d6 REZ Non-Black / 2d6 REZ Black ICE" },
  Sword:          { class:"Anti-Program",   atk:1, def:0, rez:0, effect:"3d6 REZ Black ICE / 2d6 REZ Non-Black" },
  DeckKRASH:      { class:"Anti-Personnel", atk:0, def:0, rez:0, effect:"Unsafe Jack Out + all Rezzed enemy Black ICE effects" },
  Hellbolt:       { class:"Anti-Personnel", atk:2, def:0, rez:0, effect:"2d6 brain + fire (2 HP/turn)" },
  Nervescrub:     { class:"Anti-Personnel", atk:0, def:0, rez:0, effect:"INT/REF/DEX -1d6 (min 1) for 1 hour" },
  PoisonFlatline: { class:"Anti-Personnel", atk:0, def:0, rez:0, effect:"Destroy 1 random Non-Black Program" },
  Superglue:      { class:"Anti-Personnel", atk:2, def:0, rez:0, effect:"Cannot progress or safe Jack Out for 1d6 Rounds" },
  Vrizzbolt:      { class:"Anti-Personnel", atk:1, def:0, rez:0, effect:"1d6 brain + -1 NET Actions next Turn (min 2)" },
};

// ── Difficulty ────────────────────────────────────────────────────────────────
export const DV_BY_DIFFICULTY = { basic:6, standard:8, uncommon:10, advanced:12 };

// ── Floor tile image path ─────────────────────────────────────────────────────
export function tileExt() {
  try { return game.settings.get("cpr-netrunner","useAnimatedTiles") ? "webm" : "webp"; }
  catch { return "webp"; }
}

export function getTileImagePath(tilesRoot, nodeType, nodeData, variant = 1) {
  const v   = Math.max(1, Math.min(13, Math.round(variant)));
  const ext = tileExt();
  const vb  = (v % 4) + 1;
  switch (nodeType) {
    case "black_ice": return `${tilesRoot}/BLACKICE/BLACKICE-TILE (${v}).${ext}`;
    case "password":  return `${tilesRoot}/BLANK-TILES/RED/BG-RED${vb}.${ext}`;
    case "file":      return `${tilesRoot}/BLANK-TILES/GREEN/BG-GREEN${vb}.${ext}`;
    default:          return `${tilesRoot}/BLANK-TILES/BLUE/BG-BLUE${vb}.${ext}`;
  }
}

// ── Token icon path ───────────────────────────────────────────────────────────
export function getTokenIconPath(tilesRoot, entityType, entityName = "") {
  const ext       = tileExt();
  const iconsNR   = `${tilesRoot}/ICONS/NETRUNNER`;
  const iconsComp = `${tilesRoot}/ICONS/COMPUTING`;
  switch (entityType) {
    case "netrunner":
    case "npc":
      return `${iconsComp}/NETRUNNER.${ext}`;
    case "black_ice": {
      const upper = entityName.toUpperCase();
      const file  = upper === "SABERTOOTH" ? "SABRETOOTH" : upper;
      return `${iconsNR}/${file}.${ext}`;
    }
    case "demon":
      return `${iconsNR}/${entityName.toUpperCase()}.${ext}`;
    default:
      return `${iconsNR}/BLACKICE.${ext}`;
  }
}

export function getNodeTypeIconPath(tilesRoot, nodeType, nodeData) {
  const ext     = tileExt();
  const iconsNR = `${tilesRoot}/ICONS/NETRUNNER`;
  switch (nodeType) {
    case "password":     return `${iconsNR}/PASSWORD.${ext}`;
    case "file":         return `${iconsNR}/FILE.${ext}`;
    case "control_node": return `${iconsNR}/CONTROLNODE.${ext}`;
    case "system":       return `${iconsNR}/ROOT.${ext}`;
    case "black_ice":    return `${iconsNR}/BLACKICE.${ext}`;
    case "demon":        return `${iconsNR}/DEMON.${ext}`;
    default:             return null;
  }
}

// ── Tile variant folder scanning ──────────────────────────────────────────────

/**
 * Returns the folder path and filename prefix for tile variants of the given
 * node type. Used to browse the actual files rather than assume a count.
 */
export function getTileScanFolder(tilesRoot, nodeType) {
  switch (nodeType) {
    case "black_ice": return { folder: `${tilesRoot}/BLACKICE`,          prefix: "BLACKICE-TILE" };
    case "password":  return { folder: `${tilesRoot}/BLANK-TILES/RED`,   prefix: "BG-RED" };
    case "file":      return { folder: `${tilesRoot}/BLANK-TILES/GREEN`, prefix: "BG-GREEN" };
    default:          return { folder: `${tilesRoot}/BLANK-TILES/BLUE`,  prefix: "BG-BLUE" };
  }
}

/**
 * Browse the tile folder for the given node type and return a sorted array of
 * path stems (full path minus extension).
 * Returns [] on any browse error (e.g. folder not found).
 */
export async function scanTileVariants(tilesRoot, nodeType) {
  const { folder, prefix } = getTileScanFolder(tilesRoot, nodeType);
  try {
    const result = await FilePicker.browse("data", folder);
    return result.files
      .filter(f => {
        const name = f.split("/").pop();
        return name.startsWith(prefix) && name.endsWith(".webp");
      })
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      .map(f => f.replace(/\.webp$/, ""));  // store stem, not full URL
  } catch (e) {
    console.warn(`CPR Netrunner | Failed to scan tile folder "${folder}":`, e);
    return [];
  }
}
