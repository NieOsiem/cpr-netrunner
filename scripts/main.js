/**
 * main.js
 * CPR Netrunner module entry point.
 *
 * Registers:
 *   - World settings (tile path, arch index, active run, per-arch data)
 *   - Hooks (init, ready, tile double-click)
 *   - Socket handlers
 *   - Global API: window.CprNetrunner
 */

import { loadAllArchitectures, loadArchitecture, saveArchitecture } from "./data/architecture.js";
import { loadCustomBlackIce } from "./data/node-defs.js";
import { loadRunState, saveRunState } from "./data/run-state.js";
import { initSocket, onSocket, socketBroadcastState } from "./socket.js";
import { moveToken, findTokenById, findRunnerByUser, revealNode, addLogEntry, initNodeStates, initializeSpawns, resetRun, beatNode, applyDamageToToken } from "./data/run-state.js";
import { openNetrun, getNetrunApp, NetrunApp } from "./apps/netrun-app.js";
import { ArchEditorApp } from "./apps/arch-editor.js";
import { MODULE_ID } from "./utils.js";

// ── Settings Registration ─────────────────────────────────────────────────────

Hooks.once("init", () => {

  // Path to the NetrunningTilesV2 asset folder (relative to Foundry Data root)
  game.settings.register(MODULE_ID, "tilesRoot", {
    name:    "NetrunningTilesV2 Path",
    hint:    'Path to the NetrunningTilesV2 folder relative to your Foundry Data root. Default: "S/Prefaby/NetrunningTilesV2".',
    scope:   "world",
    config:  true,
    type:    String,
    default: "S/Prefaby/NetrunningTilesV2",
  });

  // UI font scale
  game.settings.register(MODULE_ID, "fontScale", {
    name:    "UI Font Scale",
    hint:    'Scale factor for text in the netrun windows.',
    scope:   "client",
    config:  true,
    type:    Number,
    default: 1.0,
    range:   { min: 0.75, max: 2.0, step: 0.05 },
  });

  // Custom Black ICE JSON editor
  // TODO - better black ice editor, any demon editor
  game.settings.register(MODULE_ID, "customBlackIce", {
    name:    "Custom Black ICE (JSON)",
    hint:    'Reeeeee',
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
  });

  // Animated tiles (webm) vs static (webp)
  // TODO - webm tiles don't work
  game.settings.register(MODULE_ID, "useAnimatedTiles", {
    name:    "Use Animated Tiles",
    hint:    "Use .webm animated versions of tiles and icons instead of static .webp. Requires browser support for WebM video.",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // Whether players can spectate (see) runs they're not jacked into
  game.settings.register(MODULE_ID, "allowSpectators", {
    name:    "Allow Spectators",
    hint:    "If enabled, all connected players see the netrun window (read-only) when a run is opened.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // Architecture index (list of IDs) — hidden from config panel
  game.settings.register(MODULE_ID, "arch_index", {
    scope:   "world",
    config:  false,
    type:    String,
    default: "[]",
  });

  // Active run state — single JSON blob
  game.settings.register(MODULE_ID, "netrun_active_run", {
    scope:   "world",
    config:  false,
    type:    String,
    default: "",
  });

  // Re-register any existing arch settings (from previous sessions)
  // This runs at init so saved architectures survive module reload
  try {
    const ids = JSON.parse(game.settings.get(MODULE_ID, "arch_index") ?? "[]");
    for (const id of ids) {
      const key = `arch_${id}`;
      if (!game.settings.settings.has(`${MODULE_ID}.${key}`)) {
        game.settings.register(MODULE_ID, key, {
          scope: "world", config: false, type: String, default: "{}",
        });
      }
    }
  } catch(e) {
    console.warn(`${MODULE_ID} | Failed to re-register architecture settings:`, e);
  }

  // ── Handlebars Helpers ──────────────────────────────────────────────────────
  Handlebars.registerHelper("eq",         (a, b) => a === b);
  Handlebars.registerHelper("firstChar",  (str)  => String(str || "?").charAt(0).toUpperCase());
  Handlebars.registerHelper("join",       (arr, sep) => (arr || []).join(sep));
  Handlebars.registerHelper("countNodes", (arch) => arch ? Object.keys(arch.nodes || {}).length : 0);
  Handlebars.registerHelper("neq",        (a, b) => a !== b);
  Handlebars.registerHelper("or",         (a, b) => a || b);
  Handlebars.registerHelper("and",        (a, b) => a && b);
  Handlebars.registerHelper("not",        (a)    => !a);

  console.log(`${MODULE_ID} | Initialized.`);
});

// ── Ready ─────────────────────────────────────────────────────────────────────

Hooks.once("ready", async () => {
  // Load templates
  await loadTemplates([
    `modules/${MODULE_ID}/templates/netrun-app.hbs`,
    `modules/${MODULE_ID}/templates/arch-editor.hbs`,
  ]);

  // Set up socket
  initSocket();
  _registerSocketHandlers();

  // Tile hook — tiles flagged with cpr-netrunner.archId open the netrun
  if (typeof Tile !== "undefined" && typeof Tile.prototype._onClickLeft2 === "function") {
    const _orig = Tile.prototype._onClickLeft2;
    Tile.prototype._onClickLeft2 = function(event) {
      const archId = this.document.getFlag(MODULE_ID, "archId");
      if (archId) {
        event.stopPropagation();
        // Use MAT-compatible pattern: pull userId from available context
        const userId = game.userId;
        openNetrun(archId, game.user.isGM ? null : userId);
        return;
      }
      return _orig.call(this, event);
    };
  }

  // Load custom Black ICE from setting TODO - add demons
  loadCustomBlackIce();

  // Apply font scale as CSS custom property
  const applyFontScale = () => {
    try {
      const scale = game.settings.get(MODULE_ID, "fontScale") ?? 1.0;
      document.documentElement.style.setProperty("--cpr-font-scale", String(scale));
    } catch(_) {}
  };
  applyFontScale();
  // Reapply when setting changes (Foundry fires this hook)
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === `${MODULE_ID}.fontScale`) applyFontScale();
  });

  _registerDamageButtonHandler();

  // Add "Re-open run" button to scene controls
  // TODO - do this in a better way without hooking into scene controls
  Hooks.on("getSceneControlButtons", (controls) => {
    const bar = controls.find(c => c.name === "token");
    if (!bar) return;
    bar.tools.push({
      name:  "netrun",
      title: "CPR Netrunner — Open Run",
      icon:  "fa-solid fa-network-wired",
      button: true,
      onClick: () => {
        const app = getNetrunApp();
        if (app) { app.bringToTop(); return; }
        // Re-open last active run
        try {
          const raw = game.settings.get(MODULE_ID, "netrun_active_run");
          const rs  = raw ? JSON.parse(raw) : null;
          if (rs?.archId && rs?.isActive) { openNetrun(rs.archId); return; }
        } catch(_) {}
        ui.notifications.warn("CPR Netrunner | No active run.");
      },
    });
  });

  console.log(`${MODULE_ID} | Ready. API: CprNetrunner.openEditor() / CprNetrunner.openNetrun(archId)`);
});

// ── Socket Handlers ───────────────────────────────────────────────────────────

function _registerSocketHandlers() {

  // GM tells a user to open the netrun window
  onSocket("openNetrun", async (data) => {
    const { archId, runState, targetUserId } = data;
    const isForMe = !targetUserId || targetUserId === game.userId;
    const isSpectator = game.settings.get(MODULE_ID, "allowSpectators") && !game.user.isGM;

    if (!isForMe && !isSpectator) return;
    if (game.user.isGM) return;

    // Open or update local window
    const existing = getNetrunApp();
    if (existing) {
      existing.receiveStateUpdate(archId, runState);
      existing.bringToTop();
    } else {
      new NetrunApp(archId, runState).render(true);
    }
  });

  // GM broadcasts updated state — all clients refresh their open window
  onSocket("stateUpdate", (data) => {
    const { archId, runState } = data;
    const existing = getNetrunApp();
    if (existing && existing.archId === archId) {
      existing.receiveStateUpdate(archId, runState);
    }
  });

  // Player requests to move their runner — GM validates and applies
  onSocket("requestMove", async (data) => {
    if (!game.user.isGM) return;
    if (game.user !== game.users.activeGM) return;

    const { runnerId, targetNodeId } = data;
    const runState = loadRunState();
    if (!runState) return;

    const arch   = loadArchitecture(runState.archId);
    const runner = findTokenById(runState, runnerId);
    if (!arch || !runner) return;

    // Validate: target must be connected to current position
    const currentId = runner.currentNodeId;
    const connected = arch.connections?.some(([a, b]) =>
      (a === currentId && b === targetNodeId) || (b === currentId && a === targetNodeId));

    if (connected || !currentId) {
      moveToken(runState, runnerId, targetNodeId);
      revealNode(runState, targetNodeId);
      addLogEntry(runState, `${runner.name} moved.`);
    } else {
      addLogEntry(runState, `${runner.name} attempted an illegal move (not connected).`);
    }

    await saveRunState(runState);
    socketBroadcastState(runState.archId, runState);
  });

  // Player requests an action — GM sees it in the log, applies manually
  onSocket("requestAction", async (data) => {
    if (!game.user.isGM) return;
    if (game.user !== game.users.activeGM) return;

    const { runnerId, actionType, targetNodeId, userId } = data;
    const runState = loadRunState();
    if (!runState) return;

    const runner = findTokenById(runState, runnerId);
    const name   = runner?.name ?? "Runner";
    addLogEntry(runState, `[REQUEST] ${name} → ${actionType}${targetNodeId ? ` on node` : ""}.`);

    await saveRunState(runState);
    socketBroadcastState(runState.archId, runState);
  });

  // Close all netrun windows
  onSocket("closeNetrun", () => {
    const existing = getNetrunApp();
    if (existing) existing.close();
  });

  // Architecture updated/deleted — refresh editor list if open
  onSocket("archUpdate", (data) => {
    const editorApp = Object.values(ui.windows).find(w => w instanceof ArchEditorApp);
    if (editorApp) editorApp.render(false);
  });
}

// ── Chat damage button handler ─────────────────────────────────────────────────
function _registerDamageButtonHandler() {
  // Delegated click on chat log for .cpr-dmg-btn buttons
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".cpr-dmg-btn");
    if (!btn) return;
    if (!game.user.isGM) return;

    const tokenId = btn.dataset.tokenId;
    const amount  = parseInt(btn.dataset.amount);
    if (!tokenId || isNaN(amount)) return;

    const app = getNetrunApp();
    if (!app) return;

    const tok = findTokenById(app.runState, tokenId);
    if (!tok) { ui.notifications.warn("Token not found in active run."); return; }

    const isUndo = amount < 0;
    applyDamageToToken(app.runState, tokenId, amount);
    if (tok.type === "runner") {
      addLogEntry(app.runState, isUndo
        ? `${tok.name}: heal +${-amount} HP → ${tok.currentHp}/${tok.maxHp}`
        : `${tok.name}: ${amount} damage → HP ${tok.currentHp}/${tok.maxHp}`);
    } else {
      addLogEntry(app.runState, isUndo
        ? `${tok.name}: restore +${-amount} REZ → ${tok.currentRez}/${tok.maxRez}`
        : `${tok.name}: ${amount} damage → REZ ${tok.currentRez}/${tok.maxRez}`);
    }

    await saveRunState(app.runState);
    socketBroadcastState(app.archId, app.runState);
    app.render(false);

    // Visual feedback: disable the button
    btn.disabled = true;
    btn.textContent = `Applied: ${amount}`;
    btn.style.opacity = "0.5";
  });
}

// ── Global API ────────────────────────────────────────────────────────────────

globalThis.CprNetrunner = {
  // Open the architecture editor (GM only)
  openEditor(archId = null) {
    if (!game.user.isGM) {
      ui.notifications.warn("CPR Netrunner | The architecture editor is GM-only.");
      return;
    }
    const existing = Object.values(ui.windows).find(w => w instanceof ArchEditorApp);
    if (existing) { existing.bringToTop(); return; }
    new ArchEditorApp(archId).render(true);
  },

  // Open a netrun window (GM triggers for player via MAT)
  // In MAT "Run Code": const _uid = game.users.find(u => u.character?.id === actor?.id)?.id ?? game.userId;
  //                    CprNetrunner.openNetrun("arch-uuid", _uid)
  openNetrun(archId, targetUserId = null, actorData = null) {
    if (!game.user.isGM && targetUserId && targetUserId !== game.userId) return;
    return openNetrun(archId, targetUserId, actorData);
  },

  // Open a netrun by tile flag — call from MAT on the tile
  // In MAT "Run Code": CprNetrunner.openNetrunFromTile(tile)
  openNetrunFromTile(tileDoc, actorArg = null) {
    const archId = tileDoc?.document?.getFlag?.(MODULE_ID, "archId")
      ?? tileDoc?.getFlag?.(MODULE_ID, "archId");
    if (!archId) { ui.notifications.warn("CPR Netrunner | This tile has no architecture linked."); return; }
    // MAT Run Code injects `actor` into scope; actorArg is a fallback
    let a = actorArg;
    try { if (!a) a = actor; } catch(_) {}
    const _uid = game.users.find(u => u.character?.id === a?.id)?.id ?? game.userId;
    const actorData = a ? {
      name:  a.name,
      img:   a.prototypeToken?.texture?.src ?? a.img ?? null,
      color: game.users.find(u => u.character?.id === a.id)?.color?.css ?? "#00ffcc",
    } : null;
    return openNetrun(archId, _uid, actorData);
  },

  // Link an architecture to a tile (call in console with tile selected)
  async linkTile(archId) {
    if (!game.user.isGM) return;
    if (!canvas.tiles.controlled.length) {
      ui.notifications.warn("CPR Netrunner | Select a tile on the canvas first.");
      return;
    }
    const tile = canvas.tiles.controlled[0];
    await tile.document.setFlag(MODULE_ID, "archId", archId);
    ui.notifications.info(`CPR Netrunner | Tile linked to architecture ${archId}.`);
  },

  // List all saved architectures
  listArchitectures() {
    return loadAllArchitectures().map(a => ({ id: a.id, name: a.name, nodes: Object.keys(a.nodes).length }));
  },

  // Low-level access for power users
  _loadArchitecture:  loadArchitecture,
  _saveArchitecture:  saveArchitecture,
  _loadRunState:      loadRunState,
  _saveRunState:      saveRunState,
};
