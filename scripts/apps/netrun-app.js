/**
 * netrun-app.js  — Main netrunning window.
 *
 * Layout: toolbar → [tree | right-side] → bottom token card
 *
 * Player restrictions:
 *   - Can only select/click tokens where tok.userId === game.userId
 *   - Can request move only for their linked runner
 *   - Targeting (T key) works on all visible tokens
 */

import { loadArchitecture, getNodeDisplayLabel, saveArchitecture } from "../data/architecture.js";
import {
  loadRunState, saveRunState, createRunState, initNodeStates, initializeSpawns, resetRun,
  createRunnerToken, createIceToken, createDemonToken,
  addToken, removeToken, moveToken, setTokenRez, setTokenActive,
  findRunnerByUser, findTokenById, getRunners, getIceTokens, getDemonTokens,
  revealNode, hideNode, beatNode, addLogEntry, applyDamageToToken,
} from "../data/run-state.js";
import { BLACK_ICE, DEMONS } from "../data/node-defs.js";
import { renderArchGrid } from "./grid-renderer.js";
import { PanZoom } from "./pan-zoom.js";
import { renderTokenCard } from "./token-card.js";
import { socketBroadcastState, socketOpenNetrun, socketCloseNetrun, socketRequestMove } from "../socket.js";
import { getTilesRoot, isGM, rollToChat, sendDamageCard, MODULE_ID, escHtml } from "../utils.js";

let _instance = null;
export function getNetrunApp() { return _instance; }

// ── Dialog HTML helpers ───────────────────────────────────────────────────────

function _fmUserSelect(label, selectedId = null) {
  const opts = game.users.filter(u => !u.isGM)
    .map(u => `<option value="${u.id}" ${u.id === selectedId ? "selected" : ""}>${escHtml(u.name)}</option>`)
    .join("");
  return `<div class="form-group"><label>${label}</label>
    <select name="userId"><option value="">— none —</option>${opts}</select></div>`;
}

function _fmDispositionSelect(defaultDisp = "friendly") {
  const opts = [
    { val: "friendly", label: "Friendly" },
    { val: "neutral",  label: "Neutral"  },
    { val: "enemy",    label: "Enemy"    },
  ].map(o => `<option value="${o.val}" ${o.val === defaultDisp ? "selected" : ""}>${o.label}</option>`).join("");
  return `<div class="form-group"><label>Disposition</label>
    <select name="disposition">${opts}</select></div>`;
}

function _fmNodeSelect(arch, defaultNodeId = "") {
  const opts = arch
    ? Object.values(arch.nodes)
        .map(n => `<option value="${n.id}" ${n.id === defaultNodeId ? "selected" : ""}>${escHtml(getNodeDisplayLabel(n))} (${n.col},${n.row})</option>`)
        .join("")
    : "";
  return `<div class="form-group"><label>Place on Node</label>
    <select name="nodeId"><option value="">— not placed —</option>${opts}</select></div>`;
}

function _fmIconPath(placeholder = "") {
  return `<div class="form-group"><label>Icon Path <small>(leave blank for default)</small></label>
    <input name="iconPath" placeholder="${placeholder}"/></div>`;
}

export class NetrunApp extends Application {
  constructor(archId, runState, options = {}) {
    super(options);
    this.archId       = archId;
    this.runState     = runState;
    this._arch        = null;
    this._selNodeId   = null;
    this._selTokenId  = null;
    this._targetedTokenIds = new Set();
    this._hoveredTokenId   = null;
    this._boundKeyHandler  = this._onKeyDown.bind(this);
    this._pz          = new PanZoom({ minZoom: 0.2, maxZoom: 4.0, defaultCursor: "grab" });
    this._pzReady     = false;  // prevents re-centering on every re-render

    _instance = this;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id:        "cpr-netrun-app",
      title:     "NET Architecture",
      template:  "modules/cpr-netrunner/templates/netrun-app.hbs",
      width:     1200,
      height:    780,
      resizable: true,
      classes:   ["cpr-netrunner", "netrun-app"],
    });
  }

  get title() { return this._arch ? `NET // ${this._arch.name}` : "NET Architecture"; }

  // ── Key Listener ─────────────────────────────────────────────────────────────
  _startKeyListener() { document.addEventListener("keydown", this._boundKeyHandler); }
  _stopKeyListener()  { document.removeEventListener("keydown", this._boundKeyHandler); }
  _onKeyDown(ev) {
    if (ev.key !== "t" && ev.key !== "T") return;
    if (!this._hoveredTokenId) return;
    this._handleTarget(this._hoveredTokenId, ev.shiftKey);
  }

  _handleTarget(tokenId, additive) {
    if (this._targetedTokenIds.has(tokenId)) {
      if (additive) this._targetedTokenIds.delete(tokenId);
      else this._targetedTokenIds.clear();
    } else {
      if (!additive) this._targetedTokenIds.clear();
      this._targetedTokenIds.add(tokenId);
    }
    this.render(false);
  }

  _getArch() {
    if (!this._arch || this._arch.id !== this.archId)
      this._arch = loadArchitecture(this.archId);
    return this._arch;
  }

  // ── Data ─────────────────────────────────────────────────────────────────────
  getData() {
    const arch        = this._getArch();
    const userIsGM    = isGM();
    const tilesRoot   = getTilesRoot();
    const myRunner    = !userIsGM ? findRunnerByUser(this.runState, game.userId) : null;
    if (!arch) return { error: "Architecture not found.", isGM: userIsGM };

    const selToken = this._selTokenId ? findTokenById(this.runState, this._selTokenId) : null;
    const selNode  = this._selNodeId  ? (arch.nodes[this._selNodeId] ?? null) : null;

    const gridHtml = renderArchGrid(arch, {
      runState:        this.runState,
      tilesRoot, isGM: userIsGM,
      selectedNodeId:  this._selNodeId,
      selectedTokenId: this._selTokenId,
      targetedTokenIds: this._targetedTokenIds,
    });

    const tokenCardHtml = selToken ? renderTokenCard(selToken, userIsGM) : "";
    const canMoveHere = userIsGM && selToken && this._selNodeId
      && this._selNodeId !== selToken.currentNodeId;

    return {
      isGM: userIsGM, arch, runState: this.runState, myRunner,
      selToken, selNode, selNodeId: this._selNodeId,
      tokenCardHtml, canMoveHere, gridHtml,
      runners:     getRunners(this.runState),
      iceTokens:   getIceTokens(this.runState),
      demonTokens: getDemonTokens(this.runState),
      log: (this.runState?.log ?? []).slice().reverse().slice(0, 40),
    };
  }

  // ── Listeners ─────────────────────────────────────────────────────────────────
  activateListeners(html) {
    super.activateListeners(html);
    const userIsGM = isGM();
    const treeScroll = html.find(".netrun-tree-scroll")[0];
    const gridEl     = html.find(".arch-grid")[0];

    // Pan/zoom — attach controller; center on entry node on first render only
    if (treeScroll && gridEl) {
      this._pz.attach(treeScroll, gridEl);
      if (!this._pzReady) {
        const arch = this._getArch();
        requestAnimationFrame(() => this._pz.centerOnEntry(arch, treeScroll));
        this._pzReady = true;
      }
    }

    // Node & Token Selection (Left click)
    html.find(".netrun-tree-scroll").on("click", ".arch-node", ev => {
      if ($(ev.target).closest("[data-action], .token").length) return;
      const nodeId = ev.currentTarget.dataset.nodeId;
      this._selNodeId = (this._selNodeId === nodeId) ? null : nodeId;
      this.render(false);
    });

    html.on("click", ".token[data-token-id], .side-token-item", ev => {
      ev.stopPropagation();
      const tokenId = ev.currentTarget.dataset.tokenId;
      this._selTokenId = (this._selTokenId === tokenId) ? null : tokenId;
      this.render(false);
    });

    html.on("mouseenter", ".token[data-token-id]", ev => {
      this._hoveredTokenId = ev.currentTarget.dataset.tokenId;
    });
    html.on("mouseleave", ".token[data-token-id]", ev => {
      if (this._hoveredTokenId === ev.currentTarget.dataset.tokenId) this._hoveredTokenId = null;
    });

    // Token Card & UI Actions (Delegated)
    html.find(".token-card-panel").on("click", ".stat-rollable", async ev => {
      const formula  = ev.currentTarget.dataset.roll;
      const label    = ev.currentTarget.dataset.label ?? "Roll";
      const dmgType  = ev.currentTarget.dataset.damageType ?? null;
      if (!formula) return;
      const result = await rollToChat(formula, label, { isDamage: !!dmgType, damageType: dmgType });
      if (dmgType && result?.isDamage && this._targetedTokenIds.size && userIsGM) {
        const tokenInfos = [...this._targetedTokenIds].map(id => {
          const tok = findTokenById(this.runState, id);
          return tok ? { id: tok.id, name: tok.name, type: tok.type } : null;
        }).filter(Boolean);
        if (tokenInfos.length) await sendDamageCard(result.total, label, dmgType, tokenInfos);
      }
    });

    html.find(".token-card-panel").on("click", ".btn-move-dir", ev => this._gmMoveTokenDir(ev.currentTarget.dataset.dir));
    html.find(".token-card-panel").on("click", ".btn-token-active", () => this._gmToggleTokenActive());
    html.find(".token-card-panel").on("click", ".btn-edit-token-rez", () => this._gmEditTokenRez());
    html.find(".token-card-panel").on("click", ".btn-token-reset-home", () => this._gmResetTokenHome());
    html.find(".token-card-panel").on("click", ".btn-edit-token-meta", () => this._editTokenMeta());

    html.find(".btn-reveal-node").click(() => this._gmRevealNode(true));
    html.find(".btn-hide-node").click(() => this._gmRevealNode(false));
    html.find(".btn-beat-node").click(() => this._gmBeatNode());
    html.find(".btn-move-token-here").click(() => this._gmMoveTokenToNode());
    html.find(".btn-save-gmnotes").click(() => {
      const notes = html.find(".gmnotes-input").val() ?? "";
      this._saveGmNotes(notes);
    });

    html.on("click", ".btn-rm-token", ev => { ev.stopPropagation(); this._gmRemoveToken(ev.currentTarget.dataset.tokenId); });
    html.find(".btn-add-runner").click(() => this._gmAddToken("runner"));
    html.find(".btn-add-ice").click(() => this._gmAddToken("black_ice"));
    html.find(".btn-add-demon").click(() => this._gmAddToken("demon"));

    html.find(".btn-next-round").click(() => this._gmNextRound());
    html.find(".btn-reset-acts").click(() => this._gmResetActions());
    html.find(".btn-reset-run").click(() => this._gmResetRun());
    html.find(".btn-end-run").click(() => this._gmEndRun());
    html.find(".btn-roll").click(ev => this._rollAction(ev.currentTarget.dataset.roll));
    html.find(".log-toggle").click(() => html.find(".run-log").toggleClass("collapsed"));
    
    if (!userIsGM) html.find(".btn-request-move").click(() => this._playerRequestMove());
    this._startKeyListener();

    // Mark targeted in side list
    html.find(".side-token-item").each((_, el) => {
      if (el.dataset.tokenId && this._targetedTokenIds.has(el.dataset.tokenId))
        el.classList.add("tok-targeted");
    });
    html.find(".token[data-token-id]").attr("title", "T to target");
  }

  _getAdjacentMoveOptions(arch, nodeId) {
    const node = arch.nodes[nodeId];
    if (!node) return { up:null, down:null, left:null, right:null };
    const result = { up:null, down:null, left:null, right:null };
    for (const [a, b] of arch.connections ?? []) {
      const oid = a === nodeId ? b : b === nodeId ? a : null;
      if (!oid) continue;
      const o = arch.nodes[oid];
      if (!o) continue;
      const dc = o.col - node.col, dr = o.row - node.row;
      if (dc===1&&dr===0)  result.right = oid;
      if (dc===-1&&dr===0) result.left  = oid;
      if (dc===0&&dr===-1) result.up    = oid;
      if (dc===0&&dr===1)  result.down  = oid;
    }
    return result;
  }

  // ── Edit token name/icon ──────────────────────────────────────────────────────

  async _editTokenMeta() {
    const tok = findTokenById(this.runState, this._selTokenId);
    if (!tok) return;
    const isRunner = tok.type === "runner";
    const userLabel = isRunner ? "Link to User" : "Link to User (can control this token)";
    new Dialog({
      title: `Edit: ${tok.name}`,
      content: `<form style="padding:8px">
        <div class="form-group"><label>Name</label>
          <input name="name" value="${escHtml(tok.name ?? "")}"/></div>
        <div class="form-group"><label>Icon Path <small>(Foundry-relative, e.g. icons/svg/...)</small></label>
          <input name="iconPath" value="${escHtml(tok.iconPath ?? "")}" placeholder="Leave blank for default"/></div>
        ${isRunner ? _fmDispositionSelect(tok.disposition ?? "friendly") : ""}
        ${_fmUserSelect(userLabel, tok.userId)}
      </form>`,
      buttons: {
        save: { label:"Save", callback: async h => {
          tok.name     = h.find("[name=name]").val().trim()     || tok.name;
          tok.iconPath = h.find("[name=iconPath]").val().trim() || null;
          tok.userId   = h.find("[name=userId]")?.val()         || tok.userId;
          if (isRunner) tok.disposition = h.find("[name=disposition]").val() || tok.disposition;
          addLogEntry(this.runState, `${tok.name} updated.`);
          await this._saveAndBroadcast();
        }},
        cancel: { label:"Cancel" },
      }, default:"save",
    }).render(true);
  }

  // ── GM: Add token ─────────────────────────────────────────────────────────────

  async _gmAddToken(type) {
    const arch        = this._getArch();
    const defaultNode = this._selNodeId || "";
    const nodeSel     = _fmNodeSelect(arch, defaultNode);

    if (type === "runner") {
      new Dialog({
        title: "Add Netrunner",
        content: `<form style="padding:8px">
          <div class="form-group"><label>Name</label><input name="name" value="Runner"/></div>
          ${_fmIconPath("S/Icons/netrunner.webp")}
          <div class="form-group"><label>Interface Rank</label>
            <input type="number" name="rank" value="4" min="1" max="10"/></div>
          <div class="form-group"><label>Color</label><input type="color" name="color" value="#00ffcc"/></div>
          <div class="form-group"><label>Type</label>
            <select name="npc"><option value="false">Player Character</option><option value="true">NPC</option></select></div>
          ${_fmUserSelect("Linked User")}
          ${_fmDispositionSelect("friendly")}
          ${nodeSel}
          <div class="form-group"><label>Max HP</label>
            <input type="number" name="maxHp" value="20" min="1" max="999"/></div>
        </form>`,
        buttons: {
          add: { label:"Add", callback: async h => {
            const nodeId = h.find("[name=nodeId]").val() || null;
            const isNPC  = h.find("[name=npc]").val() === "true";
            const tok = createRunnerToken({
              name:          h.find("[name=name]").val().trim() || "Runner",
              iconPath:      h.find("[name=iconPath]").val().trim() || null,
              interfaceRank: parseInt(h.find("[name=rank]").val()) || 4,
              color:         h.find("[name=color]").val() || "#00ffcc",
              isNPC,
              userId:        h.find("[name=userId]").val() || null,
              currentNodeId: nodeId, homeNodeId: nodeId,
              disposition:   h.find("[name=disposition]").val() || "friendly",
              maxHp:         isNPC ? (parseInt(h.find("[name=maxHp]").val()) || 20) : 40,
            });
            addToken(this.runState, tok);
            addLogEntry(this.runState, `${tok.name} joined the run.`);
            await this._saveAndBroadcast();
          }},
          cancel: { label:"Cancel" },
        }, default:"add",
      }).render(true);

    } else if (type === "black_ice") {
      const iceOpts = Object.keys(BLACK_ICE).map(n => `<option value="${n}">${n}</option>`).join("");
      new Dialog({
        title: "Add Black ICE Token",
        content: `<form style="padding:8px">
          <div class="form-group"><label>ICE Type</label><select name="iceName">${iceOpts}</select></div>
          ${_fmIconPath()}
          ${_fmUserSelect("Link to User (can control)")}
          ${_fmDispositionSelect("enemy")}
          ${nodeSel}
        </form>`,
        buttons: {
          add: { label:"Add", callback: async h => {
            const iceName = h.find("[name=iceName]").val();
            const nodeId  = h.find("[name=nodeId]").val() || null;
            const tok = createIceToken(iceName, nodeId, {
              currentNodeId: nodeId,
              iconPath:      h.find("[name=iconPath]").val().trim() || null,
              userId:        h.find("[name=userId]").val() || null,
              disposition:   h.find("[name=disposition]").val() || "enemy",
            });
            addToken(this.runState, tok);
            addLogEntry(this.runState, `${iceName} deployed.`);
            await this._saveAndBroadcast();
          }},
          cancel: { label:"Cancel" },
        }, default:"add",
      }).render(true);

    } else if (type === "demon") {
      const demonOpts = Object.keys(DEMONS).map(n => `<option value="${n}">${n}</option>`).join("");
      new Dialog({
        title: "Add Demon Token",
        content: `<form style="padding:8px">
          <div class="form-group"><label>Demon Type</label><select name="demonName">${demonOpts}</select></div>
          ${_fmIconPath()}
          ${_fmUserSelect("Link to User (can control)")}
          ${_fmDispositionSelect("enemy")}
          ${nodeSel}
        </form>`,
        buttons: {
          add: { label:"Add", callback: async h => {
            const demonName = h.find("[name=demonName]").val();
            const nodeId    = h.find("[name=nodeId]").val() || null;
            const tok = createDemonToken(demonName, nodeId, {
              currentNodeId: nodeId,
              iconPath:      h.find("[name=iconPath]").val().trim() || null,
              userId:        h.find("[name=userId]").val() || null,
              disposition:   h.find("[name=disposition]").val() || "enemy",
            });
            addToken(this.runState, tok);
            addLogEntry(this.runState, `${demonName} deployed.`);
            await this._saveAndBroadcast();
          }},
          cancel: { label:"Cancel" },
        }, default:"add",
      }).render(true);
    }
  }

  async _gmRemoveToken(tokenId) {
    const tok = findTokenById(this.runState, tokenId);
    if (!tok) return;
    if (!await Dialog.confirm({ title:"Remove Token", content:`<p>Remove ${tok.name}?</p>` })) return;
    addLogEntry(this.runState, `${tok.name} removed.`);
    removeToken(this.runState, tokenId);
    if (this._selTokenId === tokenId) this._selTokenId = null;
    await this._saveAndBroadcast();
  }

  // ── Token movement ────────────────────────────────────────────────────────────

  async _gmMoveTokenToNode() {
    if (!this._selTokenId || !this._selNodeId) return;
    const tok  = findTokenById(this.runState, this._selTokenId);
    const arch = this._getArch();
    if (!tok || !arch) return;
    moveToken(this.runState, this._selTokenId, this._selNodeId);
    addLogEntry(this.runState, `${tok.name} → ${getNodeDisplayLabel(arch.nodes[this._selNodeId])}`);
    await this._saveAndBroadcast();
  }

  async _gmMoveTokenDir(dir) {
    const arch = this._getArch();
    if (!this._selTokenId || !arch) return;
    const tok = findTokenById(this.runState, this._selTokenId);
    if (!tok?.currentNodeId) { ui.notifications.warn("Token is not on the map."); return; }
    const opts     = this._getAdjacentMoveOptions(arch, tok.currentNodeId);
    const targetId = opts?.[dir];
    if (!targetId) { ui.notifications.warn("No connected node in that direction."); return; }
    moveToken(this.runState, this._selTokenId, targetId);
    if (tok.type === "runner") revealNode(this.runState, targetId);
    addLogEntry(this.runState, `${tok.name} → ${getNodeDisplayLabel(arch.nodes[targetId])}`);
    await this._saveAndBroadcast();
  }

  async _playerMoveDir(dir) {
    const arch = this._getArch();
    if (!this._selTokenId || !arch) return;
    const tok = findTokenById(this.runState, this._selTokenId);
    if (!tok || tok.userId !== game.userId) return;
    const opts     = this._getAdjacentMoveOptions(arch, tok.currentNodeId);
    const targetId = opts?.[dir];
    if (!targetId) return;
    // Players send a move request; GM validates
    socketRequestMove(tok.id, targetId);
    ui.notifications.info("Move request sent.");
  }

  async _gmToggleTokenActive() {
    const tok = findTokenById(this.runState, this._selTokenId);
    if (!tok) return;
    setTokenActive(this.runState, this._selTokenId, !tok.active, null);
    addLogEntry(this.runState, `${tok.name} ${tok.active ? "activated" : "deactivated"}.`);
    await this._saveAndBroadcast();
  }

  async _gmEditTokenRez() {
    const tok = findTokenById(this.runState, this._selTokenId);
    if (!tok) return;
    const max = tok.maxRez ?? tok.maxHp ?? 10;
    const cur = tok.type === "runner" ? (tok.currentHp ?? max) : (tok.currentRez ?? max);
    const result = await Dialog.prompt({
      title:   `REZ/HP — ${tok.name}`,
      content: `<form><div class="form-group"><label>Current (max ${max})</label>
        <input type="number" name="val" value="${cur}" min="0" max="${max}"/></div></form>`,
      callback: h => parseInt(h.find("[name=val]").val()),
    });
    if (result === null || isNaN(result)) return;
    if (tok.type === "runner") {
      tok.currentHp = Math.max(0, Math.min(tok.maxHp ?? 40, result));
    } else {
      setTokenRez(this.runState, this._selTokenId, result);
    }
    addLogEntry(this.runState, `${tok.name} HP/REZ → ${result}.`);
    await this._saveAndBroadcast();
  }

  async _gmResetTokenHome() {
    const tok = findTokenById(this.runState, this._selTokenId);
    if (!tok) return;
    moveToken(this.runState, this._selTokenId, tok.homeNodeId);
    addLogEntry(this.runState, `${tok.name} returned home.`);
    await this._saveAndBroadcast();
  }

  // ── Node actions ──────────────────────────────────────────────────────────────

  async _gmRevealNode(reveal) {
    if (!this._selNodeId) return;
    if (reveal) revealNode(this.runState, this._selNodeId);
    else        hideNode(this.runState, this._selNodeId);
    addLogEntry(this.runState, `Node ${reveal ? "revealed" : "hidden"}.`);
    await this._saveAndBroadcast();
  }

  async _gmBeatNode() {
    if (!this._selNodeId) return;
    const arch = this._getArch();
    const node = arch?.nodes[this._selNodeId];
    if (!node) return;
    beatNode(this.runState, this._selNodeId);
    addLogEntry(this.runState, `${getNodeDisplayLabel(node)} beaten.`);
    await this._saveAndBroadcast();
  }

  async _saveGmNotes(notes) {
    const arch = this._getArch();
    if (!arch || !this._selNodeId) return;
    const node = arch.nodes[this._selNodeId];
    if (!node) return;
    node.gmNotes = notes;
    arch.updatedAt = Date.now();
    await saveArchitecture(arch);
    this._arch = null;
    ui.notifications.info("GM notes saved.");
  }

  // ── Round & run ───────────────────────────────────────────────────────────────

  async _gmNextRound() {
    this.runState.round++;
    for (const tok of getRunners(this.runState)) tok.netActionsUsed = 0;
    addLogEntry(this.runState, `── Round ${this.runState.round} ──`);
    await this._saveAndBroadcast();
  }

  async _gmResetActions() {
    for (const tok of getRunners(this.runState)) tok.netActionsUsed = 0;
    await this._saveAndBroadcast();
  }

  async _gmResetRun() {
    if (!await Dialog.confirm({ title:"Reset Run",
      content:"<p>Reset to initial state? Spawn tiles re-spawn their tokens.</p>" })) return;
    const arch = this._getArch();
    if (!arch) return;
    resetRun(this.runState, arch);
    // Re-reveal entry node
    if (arch.entryNodeId) revealNode(this.runState, arch.entryNodeId);
    this._selTokenId  = null;
    this._selNodeId   = null;
    addLogEntry(this.runState, "Run reset.");
    await this._saveAndBroadcast();
  }

  async _gmEndRun() {
    if (!await Dialog.confirm({ title:"End Netrun", content:"<p>End run and close all windows?</p>" })) return;
    this.runState.isActive = false;
    addLogEntry(this.runState, "▶ Run ended.");
    await this._saveAndBroadcast();
    socketCloseNetrun();
    this.close();
  }

  // ── Player ────────────────────────────────────────────────────────────────────

  async _playerRequestMove() {
    if (!this._selNodeId) { ui.notifications.warn("Select a node to move to."); return; }
    const myRunner = findRunnerByUser(this.runState, game.userId);
    if (!myRunner) { ui.notifications.warn("You have no runner in this run."); return; }
    socketRequestMove(myRunner.id, this._selNodeId);
    ui.notifications.info("Move request sent to GM.");
  }

  async _rollAction(actionName) {
    const userIsGM = isGM();
    const tok      = userIsGM
      ? (this._selTokenId ? findTokenById(this.runState, this._selTokenId) : null)
      : findRunnerByUser(this.runState, game.userId);
    const rank = tok?.interfaceRank ?? 4;
    await rollToChat(`1d10 + ${rank}`, `${actionName} Check`, {});
  }

  // ── Sync ──────────────────────────────────────────────────────────────────────

  async _saveAndBroadcast() {
    await saveRunState(this.runState);
    socketBroadcastState(this.archId, this.runState);
    this._arch = null;
    this.render(false);
  }

  receiveStateUpdate(archId, runState) {
    if (archId !== this.archId) return;
    this.runState = runState;
    this._arch    = null;
    this.render(false);
  }

  async close(options) {
    this._stopKeyListener();
    this._pz.destroy();
    if (_instance === this) _instance = null;
    return super.close(options);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────
/**
 * Auto-add runner from actor when opening via MAT macro.
 * actorData: { name, img } — pulled from the actor/token by the caller.
 */
export async function openNetrun(archId, targetUserId = null, actorData = null) {
  const arch = loadArchitecture(archId);
  if (!arch) { ui.notifications.error("CPR Netrunner | Architecture not found."); return; }

  const openLocally = !targetUserId || targetUserId === game.userId || isGM();
  if (openLocally) {
    let runState = loadRunState();
    if (isGM()) {
      if (!runState || runState.archId !== archId) {
        runState = createRunState(archId);
        initNodeStates(runState, arch);
        // Reveal entry node immediately
        if (arch.entryNodeId) revealNode(runState, arch.entryNodeId);
        initializeSpawns(runState, arch);
        await saveRunState(runState);
      }
    } else {
      // Non-GM opening: auto-add runner if we have actor data and no runner yet
      if (runState && actorData) {
        const existing = findRunnerByUser(runState, game.userId);
        if (!existing) {
          const tok = createRunnerToken({
            name:          actorData.name,
            iconPath:      actorData.img ?? null,
            userId:        game.userId,
            color:         actorData.color ?? "#00ffcc",
            disposition:   "friendly",
            interfaceRank: actorData.interfaceRank ?? 4,
          });
          addToken(runState, tok);
          addLogEntry(runState, `${tok.name} jacked in.`);
          // Players can't save — request GM to do it via socket
          socketBroadcastState(archId, runState);
        }
      }
    }
    if (!runState) {
      ui.notifications.warn("CPR Netrunner | No active run — GM must start the run first.");
      return;
    }
    if (_instance) {
      if (_instance.archId !== archId) {
        await _instance.close();
      } else {
        _instance.bringToTop();
        return;
      }
    }
    new NetrunApp(archId, runState).render(true);
  }

  if (targetUserId && targetUserId !== game.userId) {
    socketOpenNetrun(archId, loadRunState(), targetUserId);
  } else if (isGM()) {
    socketOpenNetrun(archId, loadRunState(), null);
  }
}
