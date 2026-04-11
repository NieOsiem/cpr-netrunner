/**
 * node-defs.js
 * CPR entity statblocks, node types, and path resolution.
 *
 * BLACK_ICE and DEMONS can be extended at runtime via world settings.
 * Call loadCustomBlackIce() and loadCustomDemons() once on module ready.
 *
 * NODE_ASSET_CONFIG is the mutable working copy of tile-path configuration.
 * DEFAULT_NODE_ASSET_CONFIG is the immutable hardcoded baseline.
 * loadCustomNodeAssets() resets NODE_ASSET_CONFIG to defaults then merges overrides,
 * so it is safe to call multiple times (e.g. after the editor saves).
 */

import { MODULE_ID } from "../utils.js";

// ── Node Types ─────────────────────────────────────────────────────────────────
export const NODE_TYPES = {
  black_ice:    { label: "Black ICE",     color: "#ff3030" },
  password:     { label: "Password",      color: "#4488ff" },
  file:         { label: "File",          color: "#44ff88" },
  control_node: { label: "Control Node",  color: "#ffaa00" },
  system:       { label: "System / Root", color: "#00aaff" },
  empty:        { label: "Empty Node",    color: "#445566" },
  demon:        { label: "Demon",         color: "#cc44ff" },
};

// ── Black ICE ──────────────────────────────────────────────────────────────────
// damage: { formula, type }
//   type "brain"   — damage applied to a runner's HP / brain damage track
//   type "program" — damage applied to a program's REZ
//   type "stat"    — debuff to INT/REF/DEX (still useful to flag for display)
//
// Custom entries are merged in by loadCustomBlackIce() at runtime.
// iconPath (optional) — specific file path for this ICE's token icon.
export const BLACK_ICE = {
  Asp:       { per:4, spd:6, atk:2, def:2, rez:15, class:"Anti-Personnel",
               effect:"Destroy random Program" },
  Giant:     { per:2, spd:2, atk:8, def:4, rez:25, class:"Anti-Personnel",
               effect:"3d6 brain + unsafe Jack Out + all Rezzed enemy Black ICE effects",
               damage:{ formula:"3d6", type:"brain" } },
  Hellhound: { per:6, spd:6, atk:6, def:2, rez:20, class:"Anti-Personnel",
               effect:"2d6 brain + fire (2 HP/turn until Meat Action extinguishes)",
               damage:{ formula:"2d6", type:"brain" } },
  Kraken:    { per:6, spd:2, atk:8, def:4, rez:30, class:"Anti-Personnel",
               effect:"3d6 brain + block progress/safe Jack Out until end of next Turn",
               damage:{ formula:"3d6", type:"brain" } },
  Liche:     { per:8, spd:2, atk:6, def:2, rez:25, class:"Anti-Personnel",
               effect:"INT/REF/DEX -1d6 (min 1) for 1 hour",
               damage:{ formula:"1d6", type:"stat" } },
  Raven:     { per:6, spd:4, atk:4, def:2, rez:15, class:"Anti-Personnel",
               effect:"Derezz random Defender + 1d6 brain",
               damage:{ formula:"1d6", type:"brain" } },
  Scorpion:  { per:2, spd:6, atk:2, def:2, rez:15, class:"Anti-Personnel",
               effect:"MOVE -1d6 (min 1) for 1 hour",
               damage:{ formula:"1d6", type:"stat" } },
  Skunk:     { per:2, spd:4, atk:4, def:2, rez:10, class:"Anti-Personnel",
               effect:"Slide Checks -2 (stacks)" },
  Wisp:      { per:4, spd:4, atk:4, def:2, rez:15, class:"Anti-Personnel",
               effect:"1d6 brain + -1 NET Actions next Turn (min 2)",
               damage:{ formula:"1d6", type:"brain" } },
  Dragon:    { per:6, spd:4, atk:6, def:6, rez:30, class:"Anti-Program",
               effect:"6d6 REZ to Program (Destroy if enough to Derezz)",
               damage:{ formula:"6d6", type:"program" } },
  Killer:    { per:4, spd:8, atk:6, def:2, rez:20, class:"Anti-Program",
               effect:"4d6 REZ to Program (Destroy if enough to Derezz)",
               damage:{ formula:"4d6", type:"program" } },
  Sabertooth:{ per:8, spd:6, atk:6, def:2, rez:25, class:"Anti-Program",
               effect:"6d6 REZ to Program (Destroy if enough to Derezz)",
               damage:{ formula:"6d6", type:"program" } },
};

/**
 * Merge custom ICE from the world setting into BLACK_ICE at runtime.
 * Safe to call multiple times — later calls overwrite earlier custom merges.
 */
export function loadCustomBlackIce() {
  try {
    const raw = game.settings.get(MODULE_ID, "customBlackIce");
    if (!raw || raw.trim() === "" || raw.trim() === "{}") return;
    const custom = JSON.parse(raw);
    for (const [name, stats] of Object.entries(custom)) {
      BLACK_ICE[name] = { ...(BLACK_ICE[name] ?? {}), ...stats };
    }
    console.log(`CPR Netrunner | Loaded ${Object.keys(custom).length} custom Black ICE entries.`);
  } catch (e) {
    console.warn("CPR Netrunner | Failed to parse customBlackIce setting:", e);
    ui.notifications?.warn("CPR Netrunner | Custom Black ICE JSON is invalid — check the editor.");
  }
}

// ── Demons ────────────────────────────────────────────────────────────────────
// iconPath (optional) — specific file path for this Demon's token icon.
export const DEMONS = {
  Imp:    { rez:15, interface:3, netActions:2, combatNum:14 },
  Efreet: { rez:25, interface:4, netActions:3, combatNum:14 },
  Balron: { rez:30, interface:7, netActions:4, combatNum:14 },
};

/**
 * Merge custom Demons from the world setting into DEMONS at runtime.
 * Safe to call multiple times.
 */
export function loadCustomDemons() {
  try {
    const raw = game.settings.get(MODULE_ID, "customDemons");
    if (!raw || raw.trim() === "" || raw.trim() === "{}") return;
    const custom = JSON.parse(raw);
    for (const [name, stats] of Object.entries(custom)) {
      DEMONS[name] = { ...(DEMONS[name] ?? {}), ...stats };
    }
    console.log(`CPR Netrunner | Loaded ${Object.keys(custom).length} custom Demon entries.`);
  } catch (e) {
    console.warn("CPR Netrunner | Failed to parse customDemons setting:", e);
    ui.notifications?.warn("CPR Netrunner | Custom Demons JSON is invalid — check the editor.");
  }
}

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

// ── Node Asset Configuration ──────────────────────────────────────────────────

/**
 * Hardcoded baseline configuration. Never mutated.
 * Exported so the NodeAssetsEditorApp can compare against it.
 */
export const DEFAULT_NODE_ASSET_CONFIG = {
  black_ice: {
    folder: "BLACKICE", baseName: "BLACKICE-TILE",
    supportsDV: false, defaultColor: "#ff3030",
  },
  password: {
    folder: "PASSWORD", baseName: "PASSWORD-TILE",
    supportsDV: true,
    dvFolders: ["PASSWORD-DV6", "PASSWORD-DV8", "PASSWORD-DV10", "PASSWORD-DV12"],
    defaultColor: "#4488ff",
  },
  file: {
    folder: "FILE", baseName: "FILE-TILE",
    supportsDV: true,
    dvFolders: ["FILE-DV6", "FILE-DV8", "FILE-DV10", "FILE-DV12"],
    defaultColor: "#44ff88",
  },
  control_node: {
    folder: "CONTROLNODE", baseName: "CONTROLNODE-TILE",
    supportsDV: true,
    dvFolders: ["CONTROLNODE-DV6", "CONTROLNODE-DV8", "CONTROLNODE-DV10", "CONTROLNODE-DV12"],
    defaultColor: "#ffaa00",
  },
  system: {
    folder: "ROOT", baseName: "ROOT-TILE",
    supportsDV: false, defaultColor: "#00aaff",
  },
  empty: {
    folder: "BLANK-TILES/SKY", baseName: "BG-SKY",
    supportsDV: false, defaultColor: "#445566",
  },
  demon: {
    folder: "DEMON", baseName: "DEMON-TILE",
    supportsDV: false, defaultColor: "#cc44ff",
  },
};

/**
 * Mutable working copy — starts equal to defaults.
 * loadCustomNodeAssets() resets this to defaults then merges world-setting overrides,
 * so calling it multiple times (e.g. after the editor saves) is always safe.
 */
export const NODE_ASSET_CONFIG = JSON.parse(JSON.stringify(DEFAULT_NODE_ASSET_CONFIG));

/**
 * Load custom node asset paths from world settings into NODE_ASSET_CONFIG.
 * Always resets to defaults first to prevent stale data from previous calls.
 */
export async function loadCustomNodeAssets() {
  // Reset to hardcoded defaults before merging so successive calls are idempotent
  for (const [key, def] of Object.entries(DEFAULT_NODE_ASSET_CONFIG)) {
    NODE_ASSET_CONFIG[key] = JSON.parse(JSON.stringify(def));
  }

  try {
    const raw = game.settings.get(MODULE_ID, "customNodeAssets");
    if (!raw || raw.trim() === "" || raw.trim() === "{}") return;

    const custom = JSON.parse(raw);
    let count = 0;

    for (const [nodeType, config] of Object.entries(custom)) {
      const base = DEFAULT_NODE_ASSET_CONFIG[nodeType];
      if (base) {
        // Merge over the default, preserving structural fields like supportsDV
        NODE_ASSET_CONFIG[nodeType] = { ...base, ...config };
      } else {
        NODE_ASSET_CONFIG[nodeType] = config;
      }
      count++;
    }

    if (count > 0) {
      console.log(`CPR Netrunner | Loaded ${count} custom node asset path(s).`);
    }
  } catch (e) {
    console.warn("CPR Netrunner | Failed to parse customNodeAssets setting:", e);
    ui.notifications?.warn("CPR Netrunner | Custom Node Assets JSON is invalid — check the editor.");
  }
}

// ── Floor tile image path ─────────────────────────────────────────────────────
export function tileExt() {
  try { return game.settings.get(MODULE_ID, "useAnimatedTiles") ? "webm" : "webp"; }
  catch { return "webp"; }
}

/**
 * Resolve the floor-tile image path for a node.
 *
 * @param {string} tilesRoot - Base path to the tiles directory
 * @param {string} nodeType  - Key from NODE_TYPES
 * @param {object} nodeData  - Node data object (may contain .dv)
 * @param {number} variant   - 1–13 tile variant index
 * @returns {string} Full path to the tile image
 */
export function getTileImagePath(tilesRoot, nodeType, nodeData, variant = 1) {
  // Fallback for unknown types — use empty sky tile
  const config = NODE_ASSET_CONFIG[nodeType] ?? NODE_ASSET_CONFIG.empty;

  const { folder, baseName, supportsDV, dvFolders } = config;
  const ext = tileExt();
  const v   = Math.max(1, Math.min(13, Math.round(variant)));

  // DV-specific tile variant
  if (supportsDV && dvFolders && nodeData?.dv != null) {
    const dvValue = parseInt(nodeData.dv);
    let dvFolder;
    if      (dvValue <= 7)  dvFolder = dvFolders[0];
    else if (dvValue <= 9)  dvFolder = dvFolders[1];
    else if (dvValue <= 11) dvFolder = dvFolders[2];
    else                    dvFolder = dvFolders[3];

    const dvBaseName = `${dvFolder}-TILE`;
    return `${tilesRoot}/${dvFolder}/${dvBaseName} (${v}).${ext}`;
  }

  // Generic tile
  return `${tilesRoot}/${folder}/${baseName} (${v}).${ext}`;
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
 * Returns the folder path and filename prefix used for tile variant browsing.
 */
export function getTileScanFolder(tilesRoot, nodeType) {
  const config = NODE_ASSET_CONFIG[nodeType] ?? NODE_ASSET_CONFIG.empty;
  return { folder: `${tilesRoot}/${config.folder}`, prefix: config.baseName };
}

/**
 * Browse the tile folder for the given node type and return sorted path stems
 * (full path minus extension). Returns [] on any browse error.
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
      .map(f => f.replace(/\.webp$/, ""));
  } catch (e) {
    console.warn(`CPR Netrunner | Failed to scan tile folder "${folder}":`, e);
    return [];
  }
}
