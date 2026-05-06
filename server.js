'use strict';

// ── 1. Load environment variables before anything else ───────────────────────
// Falls back to manual .env parsing when dotenv is not installed, so the
// project works out-of-the-box without an extra dependency.
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');

  for (const line of envFile.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ── 2. Bootstrap the application ─────────────────────────────────────────────
const http = require('http');
const app = require('./src/app');
const { initSocket } = require('./src/sockets');
const prisma = require('./src/config/prisma');
const {
  EXPIRATION_SWEEP_MS,
  expirationTimers,
  clearReservationTimer,
  sweepExpiredReservations,
  scheduleExistingReservations,
} = require('./src/services/reservation.service');

const port = Number(process.env.PORT || 3000);

// Attach Socket.io to the same HTTP server as Express.
const server = http.createServer(app);
initSocket(server);

// ── 3. Start server ───────────────────────────────────────────────────────────
async function start() {
  // Clear any overdue reservations from a previous run and re-hydrate timers.
  await sweepExpiredReservations();
  await scheduleExistingReservations();

  // Periodic background sweep as a safety net (timers are the primary path).
  const expirationInterval = setInterval(sweepExpiredReservations, EXPIRATION_SWEEP_MS);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  // ── 4. Graceful shutdown ───────────────────────────────────────────────────
  const shutdown = async () => {
    clearInterval(expirationInterval);

    for (const reservationId of expirationTimers.keys()) {
      clearReservationTimer(reservationId);
    }

    await prisma.$disconnect();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('Failed to start server:', error);
  await prisma.$disconnect();
  process.exit(1);
});

module.exports = app;
