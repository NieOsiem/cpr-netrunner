/**
 * node-defs.js
 * CPR entity statblocks, node types, and path resolution.
 *
 * BLACK_ICE can be extended/overridden at runtime via the "customBlackIce"
 * TODO: add this for demons
 * TODO: add option for specific custom image instead of just tileFolder
 * world setting (JSON). On module ready, loadCustomBlackIce() merges it in.
 */

import { MODULE_ID } from "../utils.js";

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
    const raw = game.settings.get(MODULE_ID, "customBlackIce");
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

/**
 * Load custom node asset configurations from world settings and merge them
 * into NODE_ASSET_CONFIG at runtime. Called once on module ready.
 * 
 * @returns {Promise<void>}
 */
export async function loadCustomNodeAssets() {
  try {
    const raw = game.settings.get(MODULE_ID, "customNodeAssets");
    if (!raw || raw.trim() === "" || raw.trim() === "{}") return;
    
    const custom = JSON.parse(raw);
    let count = 0;
    
    for (const [nodeType, config] of Object.entries(custom)) {
      if (NODE_ASSET_CONFIG[nodeType]) {
        // Merge with existing config, preserving unspecified properties
        NODE_ASSET_CONFIG[nodeType] = {
          ...NODE_ASSET_CONFIG[nodeType],
          ...config
        };
        count++;
      } else {
        // Add entirely new node type if it doesn't exist
        NODE_ASSET_CONFIG[nodeType] = config;
        count++;
      }
    }
    
    if (count > 0) {
      console.log(`CPR Netrunner | Loaded ${count} custom node asset configurations.`);
    }
  } catch (e) {
    console.warn("CPR Netrunner | Failed to parse customNodeAssets setting:", e);
    ui.notifications?.warn("CPR Netrunner | Custom Node Assets JSON is invalid — check Module Settings.");
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

// ── Node Asset Configuration ──────────────────────────────────────────────────
/**
 * Maps node types to their asset folder and tile naming conventions.
 * This configuration can be extended via world settings for custom setups.
 * 
 * For node types with DV variants:
 * - The base folder contains generic tiles (no DV-specific version)
 * - DV variant folders are named {BASE_FOLDER}-DV{value} (e.g., PASSWORD-DV6)
 * - Tile files in DV folders follow the pattern {FOLDER_NAME}-TILE ({variant}).ext
 *   Example: PASSWORD-DV6/PASSWORD-DV6-TILE (1).webp
 */
export const NODE_ASSET_CONFIG = {
  black_ice: {
    folder: "BLACKICE",
    baseName: "BLACKICE-TILE",
    supportsDV: false,
    defaultColor: "#ff3030"
  },
  password: {
    folder: "PASSWORD",
    baseName: "PASSWORD-TILE",
    supportsDV: true,
    dvFolders: ["PASSWORD-DV6", "PASSWORD-DV8", "PASSWORD-DV10", "PASSWORD-DV12"],
    defaultColor: "#4488ff"
  },
  file: {
    folder: "FILE",
    baseName: "FILE-TILE",
    supportsDV: true,
    dvFolders: ["FILE-DV6", "FILE-DV8", "FILE-DV10", "FILE-DV12"],
    defaultColor: "#44ff88"
  },
  control_node: {
    folder: "CONTROLNODE",
    baseName: "CONTROLNODE-TILE",
    supportsDV: true,
    dvFolders: ["CONTROLNODE-DV6", "CONTROLNODE-DV8", "CONTROLNODE-DV10", "CONTROLNODE-DV12"],
    defaultColor: "#ffaa00"
  },
  system: {
    folder: "ROOT",
    baseName: "ROOT-TILE",
    supportsDV: false,
    defaultColor: "#00aaff"
  },
  empty: {
    folder: "BLANK-TILES/SKY",
    baseName: "BG-SKY",
    supportsDV: false,
    defaultColor: "#445566"
  },
  demon: {
    folder: "DEMON",
    baseName: "DEMON-TILE",
    supportsDV: false,
    defaultColor: "#cc44ff"
  }
};

// ── Floor tile image path ─────────────────────────────────────────────────────
export function tileExt() {
  try { return game.settings.get(MODULE_ID, "useAnimatedTiles") ? "webm" : "webp"; }
  catch { return "webp"; }
}

/**
 * Universal function to get the correct tile image path for any node type.
 * 
 * @param {string} tilesRoot - Base path to the tiles directory
 * @param {string} nodeType - Type of node (from NODE_TYPES)
 * @param {object} nodeData - Node's data object (may contain dv, etc.)
 * @param {number} variant - Tile variant number (1-13) for randomization
 * @returns {string} Full path to the tile image
 * 
 * Logic:
 * - If node has DV and type supports DV variants: try exact DV match first
 * - Fall back to generic tile for that type if DV variant doesn't exist
 * - For nodes without DV: use generic tile directly
 * - TODO: Add support for manually selecting TILE vs 3X3 variant per node
 * - TODO: Add GM option to force generic tile even when DV variant exists
 */
export function getTileImagePath(tilesRoot, nodeType, nodeData, variant = 1) {
  const config = NODE_ASSET_CONFIG[nodeType];
  
  // Fallback to empty sky tile if node type is unknown
  if (!config) {
    console.warn(`CPR Netrunner | Unknown node type "${nodeType}", using empty tile.`);
    config = NODE_ASSET_CONFIG.empty;
  }
  
  const { folder, baseName, supportsDV, dvFolders } = config;
  const ext = tileExt();
  const v = Math.max(1, Math.min(13, Math.round(variant)));
  
  // Check if we should use a DV-specific variant
  if (supportsDV && nodeData?.dv !== undefined && nodeData.dv !== null && dvFolders) {
    const dvValue = parseInt(nodeData.dv);
    
    // Determine the DV folder based on exact DV value
    // DV6 for <=7, DV8 for 8-9, DV10 for 10-11, DV12 for >=12
    let dvFolder;
    if (dvValue <= 7) {
      dvFolder = dvFolders[0]; // PASSWORD-DV6, FILE-DV6, etc.
    } else if (dvValue <= 9) {
      dvFolder = dvFolders[1]; // PASSWORD-DV8, FILE-DV8, etc.
    } else if (dvValue <= 11) {
      dvFolder = dvFolders[2]; // PASSWORD-DV10, FILE-DV10, etc.
    } else {
      dvFolder = dvFolders[3]; // PASSWORD-DV12, FILE-DV12, etc.
    }
    
    // Construct path for DV-specific tile
    // Format: {tilesRoot}/PASSWORD-DV6/PASSWORD-DV6-TILE (1).webp
    // The tile file in DV folders uses the pattern {FOLDER_NAME}-TILE ({variant}).ext
    const dvBaseName = `${dvFolder}-TILE`; // e.g., "PASSWORD-DV6-TILE"
    const dvPath = `${tilesRoot}/${dvFolder}/${dvBaseName} (${v}).${ext}`;
    
    // Return DV-specific path
    // Note: Foundry will show a placeholder if the file doesn't exist
    // TODO: Implement FilePicker check to verify file exists before returning
    return dvPath;
  }
  
  // Return generic tile path for this node type
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
 * Returns the folder path and filename prefix for tile variants of the given
 * node type. Used to browse the actual files rather than assume a count.
 * Updated to use NODE_ASSET_CONFIG for all node types.
 */
export function getTileScanFolder(tilesRoot, nodeType) {
  const config = NODE_ASSET_CONFIG[nodeType];
  if (!config) {
    // Fallback to empty sky tiles for unknown types
    return { folder: `${tilesRoot}/BLANK-TILES/SKY`, prefix: "BG-SKY" };
  }
  
  return { folder: `${tilesRoot}/${config.folder}`, prefix: config.baseName };
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
