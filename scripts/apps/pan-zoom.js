/**
 * pan-zoom.js — Shared pan/zoom camera controller for grid views.
 *
 * Usage:
 *   // In constructor:
 *   this._pz = new PanZoom({ minZoom: 0.2, maxZoom: 4.0, defaultCursor: "grab" });
 *
 *   // In activateListeners (once DOM exists):
 *   this._pz.attach(scrollEl, gridEl);
 *   if (!this._pzReady) {
 *     requestAnimationFrame(() => this._pz.centerOnEntry(arch, scrollEl));
 *     this._pzReady = true;
 *   }
 *
 *   // In close():
 *   this._pz.destroy();
 */

import { NODE_PX, CONN_PX } from "./grid-renderer.js";

const CELL_STEP   = NODE_PX + CONN_PX;  // 196px — must match grid layout
const NODE_CENTRE = NODE_PX / 2;         // 80px  — pixel centre of one node cell

export class PanZoom {
  /**
   * @param {object} opts
   * @param {number}   [opts.minZoom=0.2]          - Minimum zoom level
   * @param {number}   [opts.maxZoom=4.0]          - Maximum zoom level
   * @param {number[]} [opts.panButtons=[1,2]]     - Mouse buttons that trigger pan
   * @param {boolean}  [opts.panOnEmptyLeft=false] - Also pan on left-click directly on the container
   * @param {string}   [opts.defaultCursor="grab"] - Cursor restored after panning ends
   * @param {boolean}  [opts.cssFixup=false]       - Force overflow:hidden + zero padding on scroll container
   */
  constructor(opts = {}) {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this._opts = {
      minZoom:        0.2,
      maxZoom:        4.0,
      panButtons:     [1, 2],
      panOnEmptyLeft: false,
      defaultCursor:  "grab",
      cssFixup:       false,
      ...opts,
    };
    this._gridEl    = null;
    this._scrollEl  = null;
    this._isPanning = false;
    this._panStart  = null;
    this._onMove    = null;
    this._onUp      = null;
  }

  attach(scrollEl, gridEl) {
    this.destroy();  // clean up any previous window listeners
    this._scrollEl = scrollEl;
    this._gridEl   = gridEl;
    const opts = this._opts;

    if (opts.cssFixup) {
      scrollEl.style.overflow      = "hidden";
      scrollEl.style.padding       = "0";
      scrollEl.style.border        = "0";
      scrollEl.style.margin        = "0";
      gridEl.style.margin          = "0";
      gridEl.style.transformOrigin = "0 0";
    }

    // Wheel zoom toward cursor position
    scrollEl.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const rect    = scrollEl.getBoundingClientRect();
      const mx      = ev.clientX - rect.left;
      const my      = ev.clientY - rect.top;
      const factor  = ev.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(opts.minZoom, Math.min(opts.maxZoom, this.zoom * factor));
      const scale   = newZoom / this.zoom;

      this.panX = mx - scale * (mx - this.panX);
      this.panY = my - scale * (my - this.panY);
      this.zoom = newZoom;
      this.applyTransform();
    }, { passive: false });

    // Pan on configured mouse buttons (and optionally left-click on empty container)
    scrollEl.addEventListener("mousedown", (ev) => {
      const isPanButton = opts.panButtons.includes(ev.button);
      const isEmptyLeft = opts.panOnEmptyLeft && ev.button === 0 && ev.target === scrollEl;
      if (!isPanButton && !isEmptyLeft) return;
      ev.preventDefault();
      this._isPanning = true;
      this._panStart  = { mx: ev.clientX, my: ev.clientY, panX: this.panX, panY: this.panY };
      scrollEl.style.cursor = "grabbing";
    });

    // Window-level handlers so pan continues if cursor leaves the container
    // TODO - this doesn't work
    this._onMove = (ev) => {
      if (!this._isPanning) return;
      this.panX = this._panStart.panX + (ev.clientX - this._panStart.mx);
      this.panY = this._panStart.panY + (ev.clientY - this._panStart.my);
      this.applyTransform();
    };
    this._onUp = () => {
      if (!this._isPanning) return;
      this._isPanning = false;
      scrollEl.style.cursor = opts.defaultCursor;
    };

    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("mouseup",   this._onUp);
    scrollEl.addEventListener("mouseleave",  this._onUp);
    scrollEl.addEventListener("contextmenu", ev => ev.preventDefault());

    this.applyTransform();
  }

  /** Write current pan/zoom state to the grid element's transform. */
  applyTransform() {
    if (!this._gridEl) return;
    this._gridEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  /**
   * Reset zoom to 1.0 and center the view on the architecture's entry node.
   * Falls back to the top-left corner if the arch has no entry node.
   *
   * @param {object}      arch     - The architecture data object
   * @param {HTMLElement} scrollEl - Container element to read dimensions from
   */
  centerOnEntry(arch, scrollEl) {
    const el = scrollEl ?? this._scrollEl;
    if (!el) return;

    let worldX = NODE_CENTRE;
    let worldY = NODE_CENTRE;
    if (arch?.entryNodeId && arch.nodes?.[arch.entryNodeId]) {
      const node = arch.nodes[arch.entryNodeId];
      worldX = node.col * CELL_STEP + NODE_CENTRE;
      worldY = node.row * CELL_STEP + NODE_CENTRE;
    }

    this.zoom = 1.0;
    this.panX = el.clientWidth  / 2 - worldX;
    this.panY = el.clientHeight / 2 - worldY;
    this.applyTransform();
  }

  /** Remove the window-level listeners. Call from the app's close() method. */
  destroy() {
    if (this._onMove) window.removeEventListener("mousemove", this._onMove);
    if (this._onUp)   window.removeEventListener("mouseup",   this._onUp);
    this._onMove = null;
    this._onUp   = null;
  }
}
