/**
 * generator.js
 * Generates random CPR architectures into the grid-based data model.
 *
 * Layout strategy:
 *   Main path → left to right, at the vertical midpoint of the grid.
 *   Branches  → upward or downward from the branch-starting node,
 *               alternating direction so they don't collide.
 * All connections are added explicitly after placing nodes.
 */

import {
  createBlankArchitecture, createNode, addNodeAtPos,
  addConnection, getNodeAtPos,
} from "./architecture.js";
import { DV_BY_DIFFICULTY } from "./node-defs.js";

function roll1d6()  { return Math.ceil(Math.random() * 6);  }
function roll1d10() { return Math.ceil(Math.random() * 10); }
function roll3d6()  { return [0,0,0].reduce(s => s + Math.ceil(Math.random()*6), 0); }

// ── Tables ────────────────────────────────────────────────────────────────────

// Entries map roll1d6() results (1-6) via index (r-1).
const LOBBY_TABLE = [
  { type:"file",      data:{ dv:6 } },
  { type:"password",  data:{ dv:6 } },
  { type:"password",  data:{ dv:8 } },
  { type:"black_ice", data:{ spawns:[{ type:"black_ice", iceName:"Skunk"  }] } },
  { type:"black_ice", data:{ spawns:[{ type:"black_ice", iceName:"Wisp"   }] } },
  { type:"black_ice", data:{ spawns:[{ type:"black_ice", iceName:"Killer" }] } },
];

function bodyEntry(roll, difficulty) {
  const B="basic", S="standard", U="uncommon", A="advanced";
  const ice  = n => [{ type:"black_ice", data:{ spawns:[{ type:"black_ice", iceName:n }] } }];
  const iceN = (n,c) => [{ type:"black_ice", data:{ spawns: Array.from({length:c}, () => ({ type:"black_ice", iceName:n })) } }];
  const iceA = (...ns) => [{ type:"black_ice", data:{ spawns: ns.map(n => ({ type:"black_ice", iceName:n })) } }];
  const pwd  = dv => [{ type:"password",     data:{ dv } }];
  const file = dv => [{ type:"file",         data:{ dv, label:"File" } }];
  const ctrl = dv => [{ type:"control_node", data:{ dv, label:"System" } }];

  const T = {
    3:  { [B]:ice("Hellhound"),              [S]:iceN("Hellhound",2),           [U]:ice("Kraken"),               [A]:iceN("Hellhound",3) },
    4:  { [B]:ice("Sabertooth"),             [S]:iceA("Hellhound","Killer"),    [U]:iceA("Hellhound","Scorpion"),[A]:iceN("Asp",2) },
    5:  { [B]:iceN("Raven",2),              [S]:iceN("Skunk",2),               [U]:iceA("Hellhound","Killer"),  [A]:iceA("Hellhound","Liche") },
    6:  { [B]:ice("Hellhound"),              [S]:ice("Sabertooth"),             [U]:iceN("Raven",2),             [A]:iceN("Wisp",3) },
    7:  { [B]:ice("Wisp"),                   [S]:ice("Scorpion"),               [U]:ice("Sabertooth"),           [A]:iceA("Hellhound","Sabertooth") },
    8:  { [B]:ice("Raven"),                  [S]:ice("Hellhound"),              [U]:ice("Hellhound"),            [A]:ice("Kraken") },
    9:  { [B]:pwd(6),  [S]:pwd(8),  [U]:pwd(10),  [A]:pwd(12) },
    10: { [B]:file(6), [S]:file(8), [U]:file(10), [A]:file(12) },
    11: { [B]:ctrl(6), [S]:ctrl(8), [U]:ctrl(10), [A]:ctrl(12) },
    12: { [B]:pwd(6),  [S]:pwd(8),  [U]:pwd(10),  [A]:pwd(12) },
    13: { [B]:ice("Skunk"),   [S]:ice("Asp"),    [U]:ice("Killer"), [A]:ice("Giant") },
    14: { [B]:ice("Asp"),     [S]:ice("Killer"), [U]:ice("Liche"),  [A]:ice("Dragon") },
    15: { [B]:ice("Scorpion"),[S]:ice("Liche"),  [U]:ice("Dragon"), [A]:iceA("Killer","Scorpion") },
    16: { [B]:iceA("Killer","Skunk"),[S]:ice("Asp"), [U]:iceA("Asp","Raven"), [A]:ice("Kraken") },
    17: { [B]:iceN("Wisp",3),[S]:iceN("Raven",3),[U]:iceA("Dragon","Wisp"),  [A]:iceA("Raven","Wisp","Hellhound") },
    18: { [B]:ice("Liche"),  [S]:iceA("Liche","Raven"), [U]:ice("Giant"), [A]:iceN("Dragon",2) },
  };
  return T[roll]?.[difficulty] ?? [{ type:"empty", data:{} }];
}

// ── Generator ─────────────────────────────────────────────────────────────────
export function generateArchitecture(name, difficulty = "standard") {
  const totalFloors  = roll3d6();
  const gridWidth    = Math.max(totalFloors + 2, 6);
  const gridHeight   = 12;                               // generous vertical space for branches
  const mainRow      = Math.floor(gridHeight / 2);       // = 6

  const arch = createBlankArchitecture(name);
  arch.difficulty = difficulty;
  arch.gridWidth  = gridWidth;
  arch.gridHeight = gridHeight;
  arch.nodes      = {};
  arch.connections = [];
  arch.entryNodeId = null;

  // ── Build abstract floor list first
  const floors = [];
  for (let f = 0; f < totalFloors; f++) {
    if (f < 2) {
      const r = roll1d6();
      floors.push(LOBBY_TABLE[r - 1] ?? { type:"empty", data:{} });
    } else {
      const r    = roll3d6();
      const spec = bodyEntry(r, difficulty)[0];
      floors.push(spec);
    }
  }

  // ── Place main path (left to right, at mainRow)
  const mainNodeIds = [];
  for (let i = 0; i < floors.length; i++) {
    const spec = floors[i];
    const node = { ...createNode(spec.type, null, i, mainRow, spec.data ?? {}) };
    if (spec.extraLabel) node.label = `+${spec.extraLabel}`;
    arch.nodes[node.id] = node;
    if (i === 0) arch.entryNodeId = node.id;
    mainNodeIds.push(node.id);
    if (i > 0) addConnection(arch, mainNodeIds[i-1], mainNodeIds[i]);
  }

  // ── Determine branch points  (d10 ≥7 for floors 2+, no earlier than floor index 1)
  const branchDirs = {};   // mainCol → "up" | "down"
  let branchParity = 1;    // alternates: +1 = down, -1 = up

  for (let i = 1; i < mainNodeIds.length - 1; i++) {
    if (roll1d10() < 7) continue;
    const len = 1 + Math.floor(Math.random() * 3);
    const dir = branchParity > 0 ? "down" : "up";
    branchParity *= -1;
    branchDirs[i] = { len, dir };
  }

  // ── Place branch nodes
  for (const [colStr, { len, dir }] of Object.entries(branchDirs)) {
    const col     = parseInt(colStr);
    const rowStep = dir === "down" ? 1 : -1;
    let prevId    = mainNodeIds[col];

    for (let b = 0; b < len; b++) {
      const bRow = mainRow + rowStep * (b + 1);
      if (bRow < 0 || bRow >= gridHeight) break;
      if (getNodeAtPos(arch, col, bRow)) break;  // skip if occupied

      const r    = b < 1 ? roll1d6() : roll3d6();
      let spec;
      if (b < 1) {
        spec = LOBBY_TABLE[r - 1] ?? { type:"empty", data:{} };
      } else {
        spec = bodyEntry(r, difficulty)[0];
      }

      const node = createNode(spec.type, null, col, bRow, spec.data ?? {});
      if (spec.extraLabel) node.label = `+${spec.extraLabel}`;
      arch.nodes[node.id] = node;
      addConnection(arch, prevId, node.id);
      prevId = node.id;
    }
  }

  arch.notes = "Generated — review File/Control Node Meatspace purposes. Add Demons if Active Defenses required.";
  return arch;
}


