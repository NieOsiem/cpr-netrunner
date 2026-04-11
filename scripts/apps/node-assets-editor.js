/**
 * node-assets-editor.js
 * Editor for NODE_ASSET_CONFIG overrides stored in the "customNodeAssets" world setting.
 * Lets GMs change the folder paths and base names used to look up floor tiles,
 * without touching any code.
 */

import { DEFAULT_NODE_ASSET_CONFIG, NODE_TYPES, loadCustomNodeAssets } from "../data/node-defs.js";
import { MODULE_ID } from "../utils.js";

// ── Public opener ──────────────────────────────────────────────────────────────

export function openNodeAssetsEditor() {
  const existing = Object.values(ui.windows).find(w => w instanceof NodeAssetsEditorApp);
  if (existing) { existing.bringToTop(); return; }
  new NodeAssetsEditorApp().render(true);
}

// ── Thin FormApplication wrapper for registerMenu ──────────────────────────────

export class OpenNodeAssetsEditorMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: "" });
  }
  render() { openNodeAssetsEditor(); }
  async _updateObject() {}
}

// ── App ───────────────────────────────────────────────────────────────────────

export class NodeAssetsEditorApp extends Application {
  constructor(options = {}) {
    super(options);
    this._dirty = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id:        "cpr-node-assets-editor",
      title:     "Node Tile Assets Editor",
      width:     760,
      height:    620,
      resizable: true,
      classes:   ["cpr-netrunner", "node-assets-editor"],
      template:  "modules/cpr-netrunner/templates/node-assets-editor.hbs",
    });
  }

  // ── Data ──────────────────────────────────────────────────────────────────────

  getData() {
    // Load current overrides from the world setting
    let customOverrides = {};
    try {
      const raw = game.settings.get(MODULE_ID, "customNodeAssets");
      if (raw && raw.trim() && raw.trim() !== "{}") customOverrides = JSON.parse(raw);
    } catch {
      console.warn("CPR Netrunner | NodeAssetsEditor: failed to parse customNodeAssets.");
    }

    // Build one entry per node type, merging custom overrides over defaults
    const nodeTypes = Object.entries(DEFAULT_NODE_ASSET_CONFIG).map(([key, def]) => {
      const override = customOverrides[key] ?? {};
      const dvFolders = (override.dvFolders ?? def.dvFolders) ?? [];
      return {
        key,
        label:       NODE_TYPES[key]?.label ?? key,
        folder:      override.folder   ?? def.folder,
        baseName:    override.baseName ?? def.baseName,
        supportsDV:  def.supportsDV,           // structural, never overridden
        dvFolder0:   dvFolders[0] ?? "",
        dvFolder1:   dvFolders[1] ?? "",
        dvFolder2:   dvFolders[2] ?? "",
        dvFolder3:   dvFolders[3] ?? "",
        hasOverride: Object.keys(override).length > 0,
        // expose defaults so the template can show reset hints
        defaultFolder:   def.folder,
        defaultBaseName: def.baseName,
        defaultDV:       def.dvFolders ?? [],
      };
    });

    return { nodeTypes, dirty: this._dirty };
  }

  // ── Listeners ─────────────────────────────────────────────────────────────────

  activateListeners(html) {
    super.activateListeners(html);

    // Mark dirty on any input change
    html.find("input").on("input", () => {
      this._dirty = true;
      html.find(".dirty-dot").addClass("show");
    });

    // Per-row reset buttons
    html.find(".btn-reset-type").click(ev => {
      const key  = ev.currentTarget.dataset.type;
      const def  = DEFAULT_NODE_ASSET_CONFIG[key];
      if (!def) return;
      const row = html.find(`.node-type-card[data-type="${key}"]`);
      row.find("[name=folder]").val(def.folder);
      row.find("[name=baseName]").val(def.baseName);
      if (def.supportsDV && def.dvFolders) {
        def.dvFolders.forEach((v, i) => row.find(`[name=dvFolder${i}]`).val(v));
      }
      this._dirty = true;
      html.find(".dirty-dot").addClass("show");
    });

    html.find(".btn-save-all").click(() => this._saveAll(html));
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  async _saveAll(html) {
    const overrides = {};

    html.find(".node-type-card").each((_, card) => {
      const key = card.dataset.type;
      const def = DEFAULT_NODE_ASSET_CONFIG[key];
      if (!def) return;

      const folder   = $(card).find("[name=folder]").val()?.trim()   || def.folder;
      const baseName = $(card).find("[name=baseName]").val()?.trim() || def.baseName;

      // Only store entries that actually differ from defaults
      const changed = { folder, baseName };
      let hasDiff = folder !== def.folder || baseName !== def.baseName;

      if (def.supportsDV && def.dvFolders) {
        const dvFolders = [0, 1, 2, 3].map(i =>
          $(card).find(`[name=dvFolder${i}]`).val()?.trim() || def.dvFolders[i]
        );
        changed.dvFolders = dvFolders;
        if (JSON.stringify(dvFolders) !== JSON.stringify(def.dvFolders)) hasDiff = true;
      }

      if (hasDiff) overrides[key] = changed;
    });

    await game.settings.set(MODULE_ID, "customNodeAssets", JSON.stringify(overrides));
    await loadCustomNodeAssets();

    this._dirty = false;
    html.find(".dirty-dot").removeClass("show");
    ui.notifications.info("CPR Netrunner | Node asset paths saved.");
    this.render(false);
  }
}
