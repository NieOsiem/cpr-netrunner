/**
 * socket.js
 * All socket communication for cpr-netrunner.
 *
 * Message types:
 *   openNetrun    — tell a specific user to open the netrun window
 *   stateUpdate   — GM broadcasts full run state to all clients
 *   requestMove   — player requests to move (GM validates and applies)
 *   requestAction — player requests an action (GM applies effects manually)
 *   closeNetrun   — GM ends the run, close all windows
 *
 * Pattern: GM is always authority. Players send requests, GM applies & broadcasts.
 */

import { MODULE_ID } from "./utils.js";

let _handlers = {};

export function initSocket() {
  game.socket.on(`module.${MODULE_ID}`, handleIncoming);
}

function handleIncoming(data) {
  const handler = _handlers[data.type];
  if (handler) {
    handler(data);
  } else {
    console.warn(`CPR Netrunner | Unknown socket message type: ${data.type}`);
  }
}

export function onSocket(type, handler) {
  _handlers[type] = handler;
}

// ── Emit helpers ───────────────────────────────────────────────────────────────

function emit(type, payload = {}) {
  game.socket.emit(`module.${MODULE_ID}`, { type, ...payload });
}

/**
 * Tell a specific user to open the netrun window for an architecture.
 * userId = null means open for all users (spectator mode).
 */
export function socketOpenNetrun(archId, runState, targetUserId = null) {
  emit("openNetrun", { archId, runState, targetUserId });
}

/**
 * GM broadcasts full run state to all connected clients.
 * Called after every state change.
 */
export function socketBroadcastState(archId, runState) {
  emit("stateUpdate", { archId, runState });
}


//Player requests to move their runner to a node.
export function socketRequestMove(runnerId, targetNodeId) {
  emit("requestMove", { runnerId, targetNodeId, userId: game.userId });
}

/**
 * Player requests an action (sent to GM for approval/application).
 * actionType: "backdoor" | "pathfinder" | "zap" | "slide" | etc.
 */
export function socketRequestAction(runnerId, actionType, targetNodeId = null, extra = {}) {
  emit("requestAction", { runnerId, actionType, targetNodeId, extra, userId: game.userId });
}

//Close the netrun window on all clients.
export function socketCloseNetrun() {
  emit("closeNetrun", {});
}

/**
 * Notify all clients that an architecture was created/updated/deleted.
 * Other clients can refresh their architecture list.
 */
export function socketArchUpdate(archId, action = "update") {
  emit("archUpdate", { archId, action });
}
