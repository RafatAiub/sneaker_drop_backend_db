'use strict';

const { getDropSnapshot } = require('../services/drop.service');

/**
 * Module-level io reference.  Set once during server startup via setIo().
 * Using a lazy reference here prevents circular-dependency issues between
 * the socket initialiser and the services/controllers that need to emit events.
 */
let _io = null;

/**
 * Called once by src/sockets/index.js after the Socket.io server is created.
 * @param {import('socket.io').Server} io
 */
function setIo(io) {
  _io = io;
}

/**
 * Emits a raw event to all connected clients.
 * @param {string} event
 * @param {*} data
 */
function emitEvent(event, data) {
  if (!_io) return;
  _io.emit(event, data);
}

/**
 * Fetches the latest drop snapshot and broadcasts a `drop:update` event.
 * @param {number} dropId
 * @param {string} type  - e.g. 'reservation.created', 'reservation.expired', 'purchase.completed'
 * @param {object} [extra]
 */
async function emitDropUpdate(dropId, type, extra = {}) {
  if (!_io) return;

  const drop = await getDropSnapshot(dropId);
  if (!drop) return;

  _io.emit('drop:update', { type, drop, ...extra });
}

module.exports = { setIo, emitEvent, emitDropUpdate };
