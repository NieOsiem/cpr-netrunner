/**
 * custom-entity-editor.js
 * Shared editor for custom Black ICE and custom Demon entries.
 * Parameterized at construction — one app class, two entity types.
 *
 * Opens via CprNetrunner.openBlackIceEditor() / CprNetrunner.openDemonEditor(),
 * or through the module settings menu buttons.
 */

import { BLACK_ICE, DEMONS, loadCustomBlackIce, loadCustomDemons } from "../data/node-defs.js";
import { MODULE_ID, escHtml } from "../utils.js";

// ── Entity configs ─────────────────────────────────────────────────────────────
// One object per supported entity type. Passed to the app at construction time.

const ICE_CONFIG = {
  entityType: "black_ice",
  settingKey: "customBlackIce",
  builtins:   BLACK_ICE,
  windowId:   "cpr-custom-ice-editor",
  windowTitle:"Custom Black ICE Editor",
  reload:     loadCustomBlackIce,
};

const DEMON_CONFIG = {
  entityType: "demon",
  settingKey: "customDemons",
  builtins:   DEMONS,
  windowId:   "cpr-custom-demon-editor",
  windowTitle:"Custom Demon Editor",
  reload:     loadCustomDemons,
};

// ── Public openers ─────────────────────────────────────────────────────────────

export function openCustomIceEditor() {
  _openOrFocus(ICE_CONFIG);
}

export function openCustomDemonEditor() {
  _openOrFocus(DEMON_CONFIG);
}

function _openOrFocus(config) {
  const existing = Object.values(ui.windows)
    .find(w => w instanceof CustomEntityEditorApp && w._config.windowId === config.windowId);
  if (existing) { existing.bringToTop(); return; }
  new CustomEntityEditorApp(config).render(true);
}

// ── Thin FormApplication wrappers used by registerMenu ────────────────────────
// Foundry's registerMenu requires the type to extend FormApplication.
// We override render() so clicking the settings button opens our real app.

export class OpenIceEditorMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: "" });
  }
  render() { openCustomIceEditor(); }
  async _updateObject() {}
}

export class OpenDemonEditorMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: "" });
  }
  render() { openCustomDemonEditor(); }
  async _updateObject() {}
}

// ── App ───────────────────────────────────────────────────────────────────────

export class CustomEntityEditorApp extends Application {
  constructor(config, options = {}) {
    super(options);
    this._config   = config;
    this._entries  = {};    // name → stats  (custom entries only)
    this._selected = null;  // currently selected entry name, or null
    this._isNew    = false; // true while creating a brand-new entry
    this._dirty    = false;
    this._loadEntries();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      width:     820,
      height:    580,
      resizable: true,
      classes:   ["cpr-netrunner", "custom-entity-editor"],
      template:  "modules/cpr-netrunner/templates/custom-entity-editor.hbs",
    });
  }

  get id()    { return this._config.windowId; }
  get title() { return this._config.windowTitle; }

  // ── Persistence ───────────────────────────────────────────────────────────────

  _loadEntries() {
    try {
      const raw = game.settings.get(MODULE_ID, this._config.settingKey);
      this._entries = (raw && raw.trim() && raw.trim() !== "{}") ? JSON.parse(raw) : {};
    } catch {
      this._entries = {};
      console.warn(`CPR Netrunner | Failed to parse ${this._config.settingKey} setting.`);
    }
  }

  async _persistEntries() {
    await game.settings.set(MODULE_ID, this._config.settingKey, JSON.stringify(this._entries));
    this._config.reload();   // merge changes into the live data objects immediately
    this._dirty = false;
  }

  // ── Data ──────────────────────────────────────────────────────────────────────

  getData() {
    const isIce   = this._config.entityType === "black_ice";
    const isNew   = this._isNew;
    const sel     = this._selected;

    // formData is either a copy of the selected entry (with defaults filled in)
    // or default values for a brand-new entry, or null when nothing is selected.
    let formData = null;
    if (isNew) {
      formData = isIce
        ? { class: "Anti-Personnel", per: 4, spd: 4, atk: 4, def: 2, rez: 15,
            effect: "", damage: { formula: "", type: "none" }, iconPath: "" }
        : { rez: 15, interface: 3, netActions: 2, combatNum: 14, iconPath: "" };
    } else if (sel && this._entries[sel]) {
      formData = JSON.parse(JSON.stringify(this._entries[sel]));
      if (isIce) {
        if (!formData.damage) formData.damage = { formula: "", type: "none" };
        formData.damage.formula ??= "";
        formData.damage.type    ??= "none";
      }
      formData.iconPath ??= "";
    }

    return {
      isIce,
      isDemon:     !isIce,
      entries:     Object.entries(this._entries).map(([name, data]) => ({ name, ...data })),
      selectedName: isNew ? "" : (sel ?? ""),
      formData,
      showForm:    formData !== null,
      isNew,
      dirty:       this._dirty,
      iceClasses:  ["Anti-Personnel", "Anti-Program"],
      damageTypes: ["none", "brain", "program", "stat"],
    };
  }

  // ── Listeners ─────────────────────────────────────────────────────────────────

  activateListeners(html) {
    super.activateListeners(html);

    // Sidebar list
    html.find(".entity-list-item").click(ev => {
      this._selected = ev.currentTarget.dataset.name;
      this._isNew    = false;
      this._dirty    = false;
      this.render(false);
    });

    // Toolbar buttons
    html.find(".btn-new-entity").click(() => this._newEntry());
    html.find(".btn-delete-entity").click(() => this._deleteEntry());
    html.find(".btn-save-entity").click(() => this._saveCurrentEntry(html));

    // FilePicker for icon
    html.find(".btn-pick-icon").click(() => this._pickIcon(html));

    // Mark dirty on any input change in the form
    html.find(".entity-form input, .entity-form select, .entity-form textarea")
      .on("input change", () => this._markDirty(html));
  }

  _markDirty(html) {
    this._dirty = true;
    html.find(".dirty-dot").addClass("show");
  }

  // ── Entry management ──────────────────────────────────────────────────────────

  _newEntry() {
    this._selected = null;
    this._isNew    = true;
    this._dirty    = false;
    this.render(false);
  }

  async _deleteEntry() {
    if (!this._selected || this._isNew) return;
    const ok = await Dialog.confirm({
      title:   "Delete Entry",
      content: `<p>Delete <strong>${escHtml(this._selected)}</strong>? This cannot be undone.</p>`,
    });
    if (!ok) return;
    delete this._entries[this._selected];
    this._selected = null;
    this._isNew    = false;
    await this._persistEntries();
    this.render(false);
  }

  async _saveCurrentEntry(html) {
    const isIce = this._config.entityType === "black_ice";
    const name  = html.find("[name=entryName]").val()?.trim();

    if (!name) { ui.notifications.warn("CPR Netrunner | Name is required."); return; }

    if (this._config.builtins[name]) {
      ui.notifications.warn(`CPR Netrunner | "${name}" is a built-in entry and cannot be overridden here.`);
      return;
    }

    let entry;
    if (isIce) {
      const dmgFormula = html.find("[name=damageFormula]").val()?.trim();
      const dmgType    = html.find("[name=damageType]").val();
      entry = {
        class:    html.find("[name=iceClass]").val(),
        per:      parseInt(html.find("[name=per]").val())  || 0,
        spd:      parseInt(html.find("[name=spd]").val())  || 0,
        atk:      parseInt(html.find("[name=atk]").val())  || 0,
        def:      parseInt(html.find("[name=def]").val())  || 0,
        rez:      parseInt(html.find("[name=rez]").val())  || 0,
        effect:   html.find("[name=effect]").val()?.trim() || "",
        iconPath: html.find("[name=iconPath]").val()?.trim() || null,
      };
      if (dmgFormula && dmgType && dmgType !== "none") {
        entry.damage = { formula: dmgFormula, type: dmgType };
      }
    } else {
      entry = {
        rez:        parseInt(html.find("[name=rez]").val())        || 0,
        interface:  parseInt(html.find("[name=interface]").val())  || 3,
        netActions: parseInt(html.find("[name=netActions]").val()) || 2,
        combatNum:  parseInt(html.find("[name=combatNum]").val())  || 14,
        iconPath:   html.find("[name=iconPath]").val()?.trim()     || null,
      };
    }

    this._entries[name] = entry;
    this._selected      = name;
    this._isNew         = false;
    await this._persistEntries();
    this.render(false);
    ui.notifications.info(`CPR Netrunner | "${name}" saved.`);
  }

  async _pickIcon(html) {
    const current = html.find("[name=iconPath]").val() || "";
    new FilePicker({
      type:     "imagevideo",
      current,
      callback: path => {
        html.find("[name=iconPath]").val(path);
        html.find(".icon-preview").attr("src", path).removeClass("hidden");
        this._dirty = true;
        html.find(".dirty-dot").addClass("show");
      },
    }).render(true);
  }
}