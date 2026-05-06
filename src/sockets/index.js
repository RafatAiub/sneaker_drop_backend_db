'use strict';

const { Server } = require('socket.io');
const { setIo } = require('./emitter');
const { listDrops } = require('../services/drop.service');

/**
 * Initialises the Socket.io server, registers the connection handler,
 * and wires up the shared io reference used by the emitter.
 *
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  // Register the lazy reference so emitter.js can broadcast events.
  setIo(io);

  io.on('connection', async (socket) => {
    // Immediately confirm connection and hydrate the client with current drops.
    socket.emit('connected', { ok: true });
    socket.emit('drops:snapshot', await listDrops(true));
  });

  return io;
}

module.exports = { initSocket };
