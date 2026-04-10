/**
 * arch-editor.js
 * Visual architecture editor.
 *
 * Grid interaction (all via event delegation):
 *   Click empty cell      → add-node dialog (choose type)
 *   Click node            → select (highlight + show property panel)
 *   Click ↔ / ↕ button   → toggle connection between adjacent nodes
 *   Click ✕ on node       → delete node (and its connections)
 *   Click ⊕ on node       → set as entry point
 */

import {
  loadArchitecture, loadAllArchitectures, saveArchitecture, deleteArchitecture,
  createBlankArchitecture, addNodeAtPos, removeNode, updateNodeData,
  toggleConnection, getNodeDisplayLabel, countNodes,
} from "../data/architecture.js";
import { generateArchitecture } from "../data/generator.js";
import { NODE_TYPES, BLACK_ICE, DEMONS, scanTileVariants } from "../data/node-defs.js";
import { renderArchGrid } from "./grid-renderer.js";
import { PanZoom } from "./pan-zoom.js";
import { socketArchUpdate } from "../socket.js";
import { getTilesRoot, debounce, MODULE_ID } from "../utils.js";

// ── Dialog HTML helpers ───────────────────────────────────────────────────────

/** Disposition <select> for spawn dialogs — colour labels for the GM. */
function _spawnDispositionSelect() {
  return `<div class="form-group"><label>Disposition</label>
    <select name="disposition">
      <option value="enemy"    selected>Enemy (Red)</option>
      <option value="neutral">Neutral (Yellow)</option>
      <option value="friendly">Friendly (Blue)</option>
    </select></div>`;
}

export class ArchEditorApp extends Application {
  constructor(archId = null, options = {}) {
    super(options);
    this._archId         = archId;
    this._arch           = archId ? loadArchitecture(archId) : null;
    this._selectedNodeId = null;
    this._dirty          = false;
    this._pz             = new PanZoom({
      minZoom:        0.25,
      maxZoom:        3.0,
      panOnEmptyLeft: true,
      defaultCursor:  "",
      cssFixup:       true,   // force overflow:hidden + zero padding
    });
    this._pzReady        = false;  // prevents re-centering on every re-render
    this._autoSave       = debounce(() => this._doSave(), 1000);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id:        "cpr-arch-editor",
      title:     "NET Architecture Editor",
      template:  "modules/cpr-netrunner/templates/arch-editor.hbs",
      width:     1300,
      height:    800,
      resizable: true,
      classes:   ["cpr-netrunner", "arch-editor"],
    });
  }

  get title() {
    return this._arch ? `Editor // ${this._arch.name}` : "Architecture Editor";
  }

  // ── Data ─────────────────────────────────────────────────────────────────────

  getData() {
    const archList   = loadAllArchitectures();
    const arch       = this._arch;
    const tilesRoot  = getTilesRoot();
    const selNode    = arch ? (arch.nodes[this._selectedNodeId] ?? null) : null;

    const treeHtml = arch
      ? renderArchGrid(arch, {
          tilesRoot,
          isGM:           true,    // editor is always GM
          isEditor:       true,
          selectedNodeId: this._selectedNodeId,
        })
      : "";

    return {
      archList,
      arch,
      treeHtml,
      selNode,
      selNodeId: this._selectedNodeId,
      dirty:     this._dirty,
      nodeTypes: NODE_TYPES,
      blackIceList: Object.keys(BLACK_ICE),
      demonList:    Object.keys(DEMONS),
      dvOptions:    [6, 8, 10, 12],
      difficulties: ["basic", "standard", "uncommon", "advanced"],
      totalNodes:   arch ? countNodes(arch) : 0,
    };
  }

  // ── Listeners ─────────────────────────────────────────────────────────────────

  activateListeners(html) {
  super.activateListeners(html);
  const scrollEl = html.find(".editor-tree-scroll")[0];
  const gridEl   = html.find(".arch-grid")[0];

  if (scrollEl && gridEl) {
    this._pz.attach(scrollEl, gridEl);
    if (!this._pzReady) {
      requestAnimationFrame(() => this._pz.centerOnEntry(this._arch, scrollEl));
      this._pzReady = true;
    }
  }

  // ── Sidebar: architecture list
  html.find(".arch-list-item").click(ev => this._loadArch(ev.currentTarget.dataset.archId));
  html.find(".btn-new-arch").click(() => this._newArch());
  html.find(".btn-generate").click(() => this._generateArch());
  html.find(".btn-save-arch").click(() => this._doSave(true));
  html.find(".btn-delete-arch").click(() => this._deleteArch());
  html.find(".btn-open-run").click(() => this._openRun());
  html.find(".btn-copy-id").click(async () => {
    const archId = this._arch?.id;
    if (!archId) return;
    try { await game.clipboard.copyPlainText(archId); ui.notifications.info(`ID copied: ${archId}`); }
    catch (err) { ui.notifications.warn("Failed to copy ID."); console.error(err); }
  });

  // ── Metadata bar
  html.find(".arch-name-input").on("input", ev => { if (this._arch) { this._arch.name = ev.target.value; this._markDirty(); } });
  html.find(".arch-diff-select").on("change", ev => { if (this._arch) { this._arch.difficulty = ev.target.value; this._markDirty(); } });
  html.find(".arch-notes-ta").on("input", ev => { if (this._arch) { this._arch.notes = ev.target.value; this._markDirty(); } });

  // ── Grid event delegation
  const treePanel = html.find(".editor-tree-scroll");
  treePanel.on("click", "[data-action]", ev => { ev.stopPropagation(); this._onGridAction(ev.currentTarget, html); });
  treePanel.on("click", ".arch-node.node-editable", ev => {
    if ($(ev.target).closest("[data-action]").length) return;
    const nodeId = ev.currentTarget.dataset.nodeId;
    this._selectedNodeId = (this._selectedNodeId === nodeId) ? null : nodeId;
    this.render(false);
  });

  // ── Property panel
  html.find(".prop-type-sel").on("change", ev => this._onTypChange(ev.target.value));
  html.find(".prop-ice-sel").on("change", ev => this._patchData({ iceName: ev.target.value }));
  html.find(".prop-dv-sel").on("change", ev => this._patchData({ dv: parseInt(ev.target.value) }));
  html.find(".prop-label").on("input", ev => this._patchLabel(ev.target.value));
  html.find(".prop-node-label").on("input", ev => this._patchNodeLabel(ev.target.value));
  html.find(".prop-contents").on("input", ev => this._patchContents(ev.target.value));
  html.find(".prop-defenses").on("input", ev => this._patchDefenses(ev.target.value));
  html.find(".prop-demon-sel").on("change", ev => this._patchData({ demonName: ev.target.value }));
  html.on("click", ".btn-add-spawn", ev => this._addSpawn());
  html.on("click", ".btn-rm-spawn", ev => this._removeSpawn(parseInt(ev.currentTarget.dataset.idx)));
  html.on("change", ".spawn-disp-sel", ev => this._setSpawnDisposition(parseInt(ev.currentTarget.dataset.idx), ev.currentTarget.value));
  html.find(".prop-subtitle").on("input", ev => this._patchSubtitle(ev.target.value));
  html.find(".prop-gmnotes").on("input",   ev => this._patchGmNotes(ev.target.value));
  html.find(".btn-pick-tile").click(() => this._pickTileVariant());
}

  // ── Grid Actions ──────────────────────────────────────────────────────────────

  _onGridAction(el, html) {
    if (!this._arch) return;
    const { action, col, row } = el.dataset;

    switch (action) {
      case "add-node":
        this._addNodeDialog(parseInt(col), parseInt(row));
        break;

      case "toggle-conn": {
        const a = el.getAttribute("data-node-a");
        const b = el.getAttribute("data-node-b");
        if (a && b) {
          toggleConnection(this._arch, a, b);
          this._markDirty();
          this.render(false);
        }
        break;
      }

      case "delete-node": {
        const nid = el.getAttribute("data-node-id");
        this._deleteNode(nid);
        break;
      }

      case "set-entry": {
        const nid = el.getAttribute("data-node-id");
        if (this._arch.nodes[nid]) {
          this._arch.entryNodeId = nid;
          this._markDirty();
          this.render(false);
        }
        break;
      }
    }
  }

  // ── Node Management ───────────────────────────────────────────────────────────

  async _addNodeDialog(col, row) {
    if (!this._arch) return;

    new Dialog({
      title: `Add Node at (${col}, ${row})`,
      content: `
        <form style="padding:8px">
          <div class="form-group">
            <label>Node Type</label>
            <select name="type">
              ${Object.entries(NODE_TYPES).map(([k,v]) =>
                `<option value="${k}">${v.label}</option>`).join("")}
            </select>
          </div>
        </form>`,
      buttons: {
        add: {
          label: "Add",
          callback: (h) => {
            const type = h.find("[name=type]").val();
            const node = addNodeAtPos(this._arch, col, row, type);
            if (node) {
              this._selectedNodeId = node.id;
              this._markDirty();
              this.render(false);
            }
          },
        },
        cancel: { label: "Cancel" },
      },
      default: "add",
    }).render(true);
  }

  async _deleteNode(nodeId) {
    if (!this._arch || !this._arch.nodes[nodeId]) return;
    const node = this._arch.nodes[nodeId];
    const ok   = await Dialog.confirm({
      title:   "Delete Node",
      content: `<p>Delete <strong>${getNodeDisplayLabel(node)}</strong>? This also removes its connections.</p>`,
    });
    if (!ok) return;
    if (this._selectedNodeId === nodeId) this._selectedNodeId = null;
    removeNode(this._arch, nodeId);
    this._markDirty();
    this.render(false);
  }

  // ── Property Panel ────────────────────────────────────────────────────────────

  _onTypChange(newType) {
    if (!this._arch || !this._selectedNodeId) return;
    updateNodeData(this._arch, this._selectedNodeId, { type: newType });
    this._markDirty();
    this.render(false);
  }

  _patchData(changes) {
    if (!this._arch || !this._selectedNodeId) return;
    updateNodeData(this._arch, this._selectedNodeId, { data: changes });
    this._markDirty();
    this.render(false);
  }

  _patchLabel(val) {
    if (!this._arch || !this._selectedNodeId) return;
    const node = this._arch.nodes[this._selectedNodeId];
    if (node) { node.label = val; this._markDirty(); }
  }

  _patchNodeLabel(val) {
    if (!this._arch || !this._selectedNodeId) return;
    const node = this._arch.nodes[this._selectedNodeId];
    if (node) {
      node.data.label = val;
      // Store pending change without re-rendering
      this._pendingLabelChange = { nodeId: this._selectedNodeId, label: val };
      this._markDirty();
    }
  }

  _patchContents(val) {
    if (!this._arch || !this._selectedNodeId) return;
    const node = this._arch.nodes[this._selectedNodeId];
    if (node) {
      node.data.contents = val;
      this._pendingContentsChange = { nodeId: this._selectedNodeId, contents: val };
      this._markDirty();
    }
  }

  _patchDefenses(val) {
    if (!this._arch || !this._selectedNodeId) return;
    const node = this._arch.nodes[this._selectedNodeId];
    if (node) {
      node.data.defenses = val;
      this._pendingDefensesChange = { nodeId: this._selectedNodeId, defenses: val };
      this._markDirty();
    }
  }

  _addSpawn() {
    if (!this._arch || !this._selectedNodeId) return;
    const node    = this._arch.nodes[this._selectedNodeId];
    if (!node) return;
    const isIce   = node.type === "black_ice";
    const isDemon = node.type === "demon";
    if (!isIce && !isDemon) return;

    const entityLabel   = isIce ? "ICE Type" : "Demon Type";
    const entityOptions = isIce
      ? Object.keys(BLACK_ICE).map(n => `<option>${n}</option>`).join("")
      : Object.keys(DEMONS).map(n => `<option>${n}</option>`).join("");

    new Dialog({
      title: isIce ? "Add ICE Spawn" : "Add Demon Spawn",
      content: `<form style="padding:8px">
        <div class="form-group"><label>${entityLabel}</label>
          <select name="name">${entityOptions}</select>
        </div>
        ${_spawnDispositionSelect()}
      </form>`,
      buttons: {
        add: { label:"Add Spawn", callback: h => {
          const name  = h.find("[name=name]").val();
          const disp  = h.find("[name=disposition]").val() || "enemy";
          const entry = isIce
            ? { type:"black_ice", iceName:  name, disposition: disp }
            : { type:"demon",     demonName: name, disposition: disp };
          const spawns = [...(node.data.spawns ?? []), entry];
          this._patchData({ spawns });
        }},
        cancel: { label:"Cancel" },
      }, default:"add",
    }).render(true);
  }

  _removeSpawn(idx) {
    if (!this._arch || !this._selectedNodeId) return;
    const node = this._arch.nodes[this._selectedNodeId];
    if (!node) return;
    const spawns = [...(node.data.spawns ?? [])];
    spawns.splice(idx, 1);
    this._patchData({ spawns });
  }

  _setSpawnDisposition(idx, disposition) {
    if (!this._arch || !this._selectedNodeId) return;
    const node = this._arch.nodes[this._selectedNodeId];
    if (!node) return;
    const spawns = [...(node.data.spawns ?? [])];
    if (spawns[idx]) { spawns[idx] = { ...spawns[idx], disposition }; }
    this._patchData({ spawns });
  }

  _patchSubtitle(val) {
    if (!this._arch || !this._selectedNodeId) return;
    const node = this._arch.nodes[this._selectedNodeId];
    if (node) { node.subtitle = val; this._markDirty(); }
  } // <--- Added this to close the method

  _patchGmNotes(val) {
    if (!this._arch || !this._selectedNodeId) return;
    const node = this._arch.nodes[this._selectedNodeId];
    if (node) { node.gmNotes = val; this._markDirty(); }
  }

  async _pickTileVariant() {
    const node = this._arch?.nodes[this._selectedNodeId];
    if (!node) return;
    const tilesRoot = getTilesRoot();

    const stems = await scanTileVariants(tilesRoot, node.type);
    if (!stems.length) {
      ui.notifications.warn("CPR Netrunner | No tile variants found — check your NetrunningTilesV2 path in Module Settings.");
      return;
    }

    // Build preview grid — always use .webp for <img> display
    const currentStem = node.tileUrl ?? null;
    const imgHtml = stems.map(stem => {
      const isCurrent = stem === currentStem;
      return `<img class="tile-picker-img${isCurrent ? " tile-picker-current" : ""}"
                   src="${stem}.webp" data-stem="${stem}"
                   title="${stem.split("/").pop()}"
                   draggable="false"/>`;
    }).join("");

    const chosen = await new Promise(resolve => {
      let _d;
      _d = new Dialog({
        title: "Choose Floor Tile",
        content: `<div class="tile-picker-grid">${imgHtml}</div>`,
        buttons: { cancel: { label: "Cancel", callback: () => resolve(null) } },
        close: () => resolve(null),
        classes: ["cpr-netrunner", "tile-picker-dialog"],
        render: html => {
          html.find(".tile-picker-img").on("click", ev => {
            const stem = ev.currentTarget.dataset.stem;
            resolve(stem);
            _d.close();
          });
        },
      });
      _d.render(true);
    });

    if (!chosen) return;
    node.tileUrl = chosen;
    this._markDirty();
    this.render(false);
  }

  // ── Architecture Management ───────────────────────────────────────────────────

  async _loadArch(id) {
    if (this._dirty) {
      const ok = await Dialog.confirm({ title:"Unsaved Changes",
        content:"<p>Load another architecture without saving changes?</p>" });
      if (!ok) return;
    }
    this._arch           = loadArchitecture(id);
    this._archId         = id;
    this._selectedNodeId = null;
    this._dirty          = false;
    this.render(false);
  }

  _newArch() {
    this._arch           = createBlankArchitecture("New Architecture");
    this._archId         = null;
    this._selectedNodeId = this._arch.entryNodeId;
    this._dirty          = true;
    this.render(false);
  }

  async _generateArch() {
    new Dialog({
      title: "Generate Architecture",
      content: `
        <form style="padding:8px">
          <div class="form-group"><label>Name</label>
            <input name="name" value="Generated Net"/></div>
          <div class="form-group"><label>Difficulty</label>
            <select name="diff">
              <option value="basic">Basic (DV 6)</option>
              <option value="standard" selected>Standard (DV 8)</option>
              <option value="uncommon">Uncommon (DV 10)</option>
              <option value="advanced">Advanced (DV 12)</option>
            </select>
          </div>
        </form>`,
      buttons: {
        go: {
          label: "Generate",
          callback: (h) => {
            const name = h.find("[name=name]").val().trim() || "Net";
            const diff = h.find("[name=diff]").val();
            this._arch           = generateArchitecture(name, diff);
            this._archId         = null;
            this._selectedNodeId = null;
            this._dirty          = true;
            this.render(false);
          },
        },
        cancel: { label: "Cancel" },
      },
      default: "go",
    }).render(true);
  }

  async _deleteArch() {
    if (!this._archId) { ui.notifications.warn("Save the architecture first."); return; }
    const ok = await Dialog.confirm({ title:"Delete Architecture",
      content:`<p>Permanently delete <strong>${this._arch?.name}</strong>?</p>` });
    if (!ok) return;
    await deleteArchitecture(this._archId);
    socketArchUpdate(this._archId, "delete");
    this._arch = null; this._archId = null; this._dirty = false;
    this.render(false);
  }

  async _doSave(notify = false) {
    if (!this._arch) return;
    const saved  = await saveArchitecture(this._arch);
    this._archId = saved.id;
    this._dirty  = false;
    socketArchUpdate(saved.id, "update");
    if (notify) { ui.notifications.info(`"${saved.name}" saved.`); this.render(false); }
  }

  async _openRun() {
    if (!this._archId) { ui.notifications.warn("Save the architecture first."); return; }
    const { openNetrun } = await import("./netrun-app.js");
    await openNetrun(this._archId, null);
  }

  _markDirty() {
    this._dirty = true;
    this._autoSave();
  }

  async close(options) {
    this._pz.destroy();
    return super.close(options);
  }
}
