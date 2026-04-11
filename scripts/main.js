/**
 * main.js
 * CPR Netrunner module entry point.
 *
 * Registers:
 *   - World settings (tile path, arch index, active run, per-arch data,
 *     custom ICE/Demon JSON, custom node asset paths)
 *   - Module settings menu buttons (open the new editor apps)
 *   - Hooks (init, ready, tile double-click, updateActor HP sync)
 *   - Socket handlers
 *   - Global API: window.CprNetrunner
 */

import { loadAllArchitectures, loadArchitecture, saveArchitecture } from "./data/architecture.js";
import { loadCustomBlackIce, loadCustomDemons, loadCustomNodeAssets } from "./data/node-defs.js";
import { loadRunState, saveRunState } from "./data/run-state.js";
import { initSocket, onSocket, socketBroadcastState } from "./socket.js";
import {
  moveToken, findTokenById, findRunnerByUser, revealNode, addLogEntry,
  initNodeStates, initializeSpawns, resetRun, beatNode, applyDamageToToken,
  createRunnerToken, addToken,
} from "./data/run-state.js";
import { openNetrun, getNetrunApp, NetrunApp } from "./apps/netrun-app.js";
import { ArchEditorApp } from "./apps/arch-editor.js";
import {
  openCustomIceEditor, openCustomDemonEditor,
  OpenIceEditorMenu, OpenDemonEditorMenu,
} from "./apps/custom-entity-editor.js";
import { openNodeAssetsEditor, OpenNodeAssetsEditorMenu } from "./apps/node-assets-editor.js";
import { extractActorStats, actorFromUser, actorFromSelectedToken } from "./data/actor-bridge.js";
import { MODULE_ID } from "./utils.js";

// ── Settings Registration ─────────────────────────────────────────────────────

Hooks.once("init", () => {

  game.settings.register(MODULE_ID, "tilesRoot", {
    name:    "NetrunningTilesV2 Path",
    hint:    'Path to the NetrunningTilesV2 folder relative to your Foundry Data root. Default: "S/Prefaby/NetrunningTilesV2".',
    scope:   "world",
    config:  true,
    type:    String,
    default: "S/Prefaby/NetrunningTilesV2",
  });

  game.settings.register(MODULE_ID, "fontScale", {
    name:    "UI Font Scale",
    hint:    "Scale factor for text in the netrun windows.",
    scope:   "client",
    config:  true,
    type:    Number,
    default: 1.0,
    range:   { min: 0.75, max: 2.0, step: 0.05 },
  });

  game.settings.register(MODULE_ID, "useAnimatedTiles", {
    name:    "Use Animated Tiles",
    hint:    "Use .webm animated versions of tiles and icons instead of static .webp. Requires browser support for WebM video.",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "allowSpectators", {
    name:    "Allow Spectators",
    hint:    "If enabled, all connected players see the netrun window (read-only) when a run is opened.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // ── Data settings (edited via dedicated apps, not raw text) ─────────────────
  game.settings.register(MODULE_ID, "customBlackIce", {
    scope:   "world",
    config:  false,
    type:    String,
    default: "{}",
  });

  game.settings.register(MODULE_ID, "customDemons", {
    scope:   "world",
    config:  false,
    type:    String,
    default: "{}",
  });

  game.settings.register(MODULE_ID, "customNodeAssets", {
    scope:   "world",
    config:  false,
    type:    String,
    default: "{}",
  });

  // ── Internal data settings ───────────────────────────────────────────────────
  game.settings.register(MODULE_ID, "arch_index", {
    scope:   "world",
    config:  false,
    type:    String,
    default: "[]",
  });

  game.settings.register(MODULE_ID, "netrun_active_run", {
    scope:   "world",
    config:  false,
    type:    String,
    default: "",
  });

  // ── Module settings menu buttons ─────────────────────────────────────────────
  // These appear as clickable buttons inside the Foundry module settings panel.
  // Each opens a dedicated editor app. The type must extend FormApplication.
  game.settings.registerMenu(MODULE_ID, "customBlackIceEditor", {
    name:       "Custom Black ICE",
    label:      "Open Editor",
    hint:       "Add, edit, and delete custom Black ICE entries (including custom token icons).",
    icon:       "fas fa-skull",
    type:       OpenIceEditorMenu,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "customDemonEditor", {
    name:       "Custom Demons",
    label:      "Open Editor",
    hint:       "Add, edit, and delete custom Demon entries (including custom token icons).",
    icon:       "fas fa-ghost",
    type:       OpenDemonEditorMenu,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "nodeAssetsEditor", {
    name:       "Node Tile Paths",
    label:      "Open Editor",
    hint:       "Customise the folder paths used to look up floor tiles for each node type.",
    icon:       "fas fa-folder-open",
    type:       OpenNodeAssetsEditorMenu,
    restricted: true,
  });

  // Re-register any existing per-arch settings from previous sessions
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
  await loadTemplates([
    `modules/${MODULE_ID}/templates/netrun-app.hbs`,
    `modules/${MODULE_ID}/templates/arch-editor.hbs`,
    `modules/${MODULE_ID}/templates/custom-entity-editor.hbs`,
    `modules/${MODULE_ID}/templates/node-assets-editor.hbs`,
  ]);

  initSocket();
  _registerSocketHandlers();

  // ── Tile hook ──────────────────────────────────────────────────────────────
  if (typeof Tile !== "undefined" && typeof Tile.prototype._onClickLeft2 === "function") {
    const _orig = Tile.prototype._onClickLeft2;
    Tile.prototype._onClickLeft2 = function(event) {
      const archId = this.document.getFlag(MODULE_ID, "archId");
      if (archId) {
        event.stopPropagation();
        if (game.user.isGM) {
          const actor     = actorFromSelectedToken();
          const actorData = actor ? { ...extractActorStats(actor), actorId: actor.id } : null;
          openNetrun(archId, null, actorData);
        } else {
          const actor     = actorFromUser(game.userId);
          const actorData = actor ? { ...extractActorStats(actor), actorId: actor.id } : null;
          openNetrun(archId, game.userId, actorData);
        }
        return;
      }
      return _orig.call(this, event);
    };
  }

  // ── Live HP sync from actor ────────────────────────────────────────────────
  Hooks.on("updateActor", async (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, "system.derivedStats.hp.value")) return;
    const app = getNetrunApp();
    if (!app?.runState) return;

    const newHp  = foundry.utils.getProperty(changes, "system.derivedStats.hp.value");
    let changed  = false;

    for (const tok of app.runState.tokens ?? []) {
      if (tok.type !== "runner" || tok.actorId !== actor.id) continue;
      const clamped = Math.max(0, Math.min(tok.maxHp ?? 40, newHp));
      if (tok.currentHp !== clamped) { tok.currentHp = clamped; changed = true; }
    }
    if (!changed) return;

    if (game.user.isGM) {
      await saveRunState(app.runState);
      socketBroadcastState(app.archId, app.runState);
    }
    app.render(false);
  });

  // Load custom entity data from world settings
  loadCustomBlackIce();
  loadCustomDemons();
  await loadCustomNodeAssets();

  const applyFontScale = () => {
    try {
      const scale = game.settings.get(MODULE_ID, "fontScale") ?? 1.0;
      document.documentElement.style.setProperty("--cpr-font-scale", String(scale));
    } catch(_) {}
  };
  applyFontScale();
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === `${MODULE_ID}.fontScale`) applyFontScale();
  });

  _registerDamageButtonHandler();
  console.log(`${MODULE_ID} | Ready. API: CprNetrunner.openEditor() / CprNetrunner.openNetrun(archId)`);
});

// ── Socket Handlers ───────────────────────────────────────────────────────────

function _registerSocketHandlers() {

  onSocket("openNetrun", async (data) => {
    const { archId, runState, targetUserId } = data;
    const isForMe     = !targetUserId || targetUserId === game.userId;
    const isSpectator = game.settings.get(MODULE_ID, "allowSpectators") && !game.user.isGM;

    if (!isForMe && !isSpectator) return;
    if (game.user.isGM) return;

    const existing = getNetrunApp();
    if (existing) {
      existing.receiveStateUpdate(archId, runState);
      existing.bringToTop();
    } else {
      new NetrunApp(archId, runState).render(true);
    }
  });

  onSocket("stateUpdate", (data) => {
    const { archId, runState } = data;
    const existing = getNetrunApp();
    if (existing && existing.archId === archId) {
      existing.receiveStateUpdate(archId, runState);
    }
  });

  onSocket("requestMove", async (data) => {
    if (!game.user.isGM) return;
    if (game.user !== game.users.activeGM) return;

    const { runnerId, targetNodeId } = data;
    const runState = loadRunState();
    if (!runState) return;

    const arch   = loadArchitecture(runState.archId);
    const runner = findTokenById(runState, runnerId);
    if (!arch || !runner) return;

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

    const app = getNetrunApp();
    if (app?.archId === runState.archId) {
      app.receiveStateUpdate(runState.archId, runState);
    }
  });

  onSocket("requestAction", async (data) => {
    if (!game.user.isGM) return;
    if (game.user !== game.users.activeGM) return;

    const { runnerId, actionType, targetNodeId } = data;
    const runState = loadRunState();
    if (!runState) return;

    const runner = findTokenById(runState, runnerId);
    const name   = runner?.name ?? "Runner";
    addLogEntry(runState, `[REQUEST] ${name} → ${actionType}${targetNodeId ? ` on node` : ""}.`);

    await saveRunState(runState);
    socketBroadcastState(runState.archId, runState);

    const app = getNetrunApp();
    if (app?.archId === runState.archId) {
      app.receiveStateUpdate(runState.archId, runState);
    }
  });

  onSocket("requestJoin", async (data) => {
    if (!game.user.isGM) return;
    if (game.user !== game.users.activeGM) return;

    const { actorData, userId } = data;
    const runState = loadRunState();
    if (!runState) return;

    const existing = findRunnerByUser(runState, userId);
    if (existing) return;

    const arch        = loadArchitecture(runState.archId);
    const entryNodeId = arch?.entryNodeId ?? null;

    const tok = createRunnerToken({
      actorId:       actorData.actorId       ?? null,
      name:          actorData.name,
      iconPath:      actorData.iconPath       ?? null,
      userId,
      color:         actorData.color          ?? "#00ffcc",
      disposition:   "friendly",
      interfaceRank: actorData.interfaceRank  ?? 4,
      codingRank:    actorData.codingRank     ?? null,
      maxHp:         actorData.hpMax          ?? 40,
      currentHp:     actorData.hpCurrent      ?? actorData.hpMax ?? 40,
      currentNodeId: entryNodeId,
      homeNodeId:    entryNodeId,
    });
    addToken(runState, tok);
    addLogEntry(runState, `${tok.name} jacked in.`);

    await saveRunState(runState);
    socketBroadcastState(runState.archId, runState);

    const app = getNetrunApp();
    if (app?.archId === runState.archId) {
      app.receiveStateUpdate(runState.archId, runState);
    }
  });

  onSocket("closeNetrun", () => {
    const existing = getNetrunApp();
    if (existing) existing.close();
  });

  onSocket("archUpdate", () => {
    const editorApp = Object.values(ui.windows).find(w => w instanceof ArchEditorApp);
    if (editorApp) editorApp.render(false);
  });
}

// ── Chat damage button handler ─────────────────────────────────────────────────
function _registerDamageButtonHandler() {
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

    btn.disabled = true;
    btn.textContent = `Applied: ${amount}`;
    btn.style.opacity = "0.5";
  });
}

// ── Global API ────────────────────────────────────────────────────────────────

globalThis.CprNetrunner = {
  openEditor(archId = null) {
    if (!game.user.isGM) {
      ui.notifications.warn("CPR Netrunner | The architecture editor is GM-only.");
      return;
    }
    const existing = Object.values(ui.windows).find(w => w instanceof ArchEditorApp);
    if (existing) { existing.bringToTop(); return; }
    new ArchEditorApp(archId).render(true);
  },

  openNetrun(archId, targetUserId = null, actorData = null) {
    if (!game.user.isGM && targetUserId && targetUserId !== game.userId) return;
    return openNetrun(archId, targetUserId, actorData);
  },

  openNetrunFromTile(tileDoc, actorArg = null) {
    const archId = tileDoc?.document?.getFlag?.(MODULE_ID, "archId")
      ?? tileDoc?.getFlag?.(MODULE_ID, "archId");
    if (!archId) { ui.notifications.warn("CPR Netrunner | This tile has no architecture linked."); return; }

    let a = actorArg;
    try { if (!a) a = actor; } catch(_) {}

    const linkedUser = a ? game.users.find(u => u.character?.id === a.id) : null;
    const _uid       = linkedUser?.id ?? game.userId;
    const actorData  = a ? { ...extractActorStats(a), actorId: a.id } : null;
    return openNetrun(archId, _uid, actorData);
  },

  openBlackIceEditor() { openCustomIceEditor(); },
  openDemonEditor()    { openCustomDemonEditor(); },
  openNodeAssetsEditor() { openNodeAssetsEditor(); },

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

  listArchitectures() {
    return loadAllArchitectures().map(a => ({ id: a.id, name: a.name, nodes: Object.keys(a.nodes).length }));
  },

  _loadArchitecture:  loadArchitecture,
  _saveArchitecture:  saveArchitecture,
  _loadRunState:      loadRunState,
  _saveRunState:      saveRunState,
};
