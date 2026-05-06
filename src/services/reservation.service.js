'use strict';

const { ReservationStatus } = require('@prisma/client');
const prisma = require('../config/prisma');
const { emitDropUpdate } = require('../sockets/emitter');

/** How long a reservation stays valid (ms). */
const RESERVATION_WINDOW_MS = 60 * 1000;

/** How often the background sweep runs (ms). */
const EXPIRATION_SWEEP_MS = 5 * 1000;

/**
 * In-memory map of active setTimeout handles keyed by reservationId.
 * Exported so server.js can iterate it during graceful shutdown.
 * @type {Map<string, NodeJS.Timeout>}
 */
const expirationTimers = new Map();

// ---------------------------------------------------------------------------
// Timer helpers
// ---------------------------------------------------------------------------

/**
 * Cancels any scheduled expiration timer for a reservation.
 * @param {string} reservationId
 */
function clearReservationTimer(reservationId) {
  const existingTimer = expirationTimers.get(reservationId);

  if (existingTimer) {
    clearTimeout(existingTimer);
    expirationTimers.delete(reservationId);
  }
}

/**
 * Schedules (or re-schedules) automatic expiration for a reservation.
 * @param {string} reservationId
 * @param {Date|string} expiresAt
 */
function scheduleReservationExpiration(reservationId, expiresAt) {
  clearReservationTimer(reservationId);

  const delay = Math.max(new Date(expiresAt).getTime() - Date.now(), 0);

  const timer = setTimeout(async () => {
    expirationTimers.delete(reservationId);
    await expireReservationById(reservationId);
  }, delay);

  expirationTimers.set(reservationId, timer);
}

// ---------------------------------------------------------------------------
// Core expiry logic
// ---------------------------------------------------------------------------

/**
 * Atomically marks a reservation as EXPIRED, increments stock, and emits
 * a real-time update.  Returns the result object or null if no action taken.
 * @param {string} reservationId
 * @returns {Promise<object|null>}
 */
async function expireReservationById(reservationId) {
  clearReservationTimer(reservationId);

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { user: true },
    });

    if (!reservation || reservation.status !== ReservationStatus.ACTIVE) {
      return null;
    }

    if (reservation.expiresAt > now) {
      return null;
    }

    const updated = await tx.reservation.updateMany({
      where: {
        id: reservationId,
        status: ReservationStatus.ACTIVE,
        expiresAt: { lte: now },
      },
      data: {
        status: ReservationStatus.EXPIRED,
        expiredAt: now,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    const drop = await tx.drop.update({
      where: { id: reservation.dropId },
      data: { availableStock: { increment: 1 } },
    });

    return {
      reservationId,
      dropId: reservation.dropId,
      username: reservation.user.username,
      availableStock: drop.availableStock,
    };
  });

  if (!result) return null;

  await emitDropUpdate(result.dropId, 'reservation.expired', {
    reservationId: result.reservationId,
    username: result.username,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Batch / sweep helpers
// ---------------------------------------------------------------------------

/**
 * Finds all overdue ACTIVE reservations and expires each one.
 */
async function sweepExpiredReservations() {
  const expired = await prisma.reservation.findMany({
    where: {
      status: ReservationStatus.ACTIVE,
      expiresAt: { lte: new Date() },
    },
    select: { id: true },
  });

  for (const { id } of expired) {
    await expireReservationById(id);
  }
}

/**
 * On server start, re-hydrates in-memory timers from all ACTIVE reservations
 * that are still in the database (handles server restarts gracefully).
 */
async function scheduleExistingReservations() {
  const active = await prisma.reservation.findMany({
    where: { status: ReservationStatus.ACTIVE },
    select: { id: true, expiresAt: true },
  });

  for (const reservation of active) {
    scheduleReservationExpiration(reservation.id, reservation.expiresAt);
  }
}

module.exports = {
  RESERVATION_WINDOW_MS,
  EXPIRATION_SWEEP_MS,
  expirationTimers,
  clearReservationTimer,
  scheduleReservationExpiration,
  expireReservationById,
  sweepExpiredReservations,
  scheduleExistingReservations,
};
