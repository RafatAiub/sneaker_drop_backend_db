'use strict';

const { ReservationStatus } = require('@prisma/client');
const prisma = require('../config/prisma');
const { parsePositiveInteger, parseUsername } = require('../utils/parsers');
const { isActiveWindow } = require('../services/drop.service');
const {
  sweepExpiredReservations,
  scheduleReservationExpiration,
  RESERVATION_WINDOW_MS,
} = require('../services/reservation.service');
const { emitDropUpdate } = require('../sockets/emitter');

/**
 * POST /api/reservations  &  POST /reserve  (legacy alias)
 *
 * Atomically decrements stock and creates an ACTIVE reservation.
 * Rejects if the drop is inactive, stock is 0, or the user already has
 * an active reservation for the same drop.
 */
async function handleReserve(req, res) {
  try {
    await sweepExpiredReservations();

    const dropId = parsePositiveInteger(req.body.dropId ?? req.body.itemId, 'dropId');
    const username = parseUsername(req.body.username ?? req.body.userId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESERVATION_WINDOW_MS);

    const reservation = await prisma.$transaction(async (tx) => {
      // Upsert the user so callers don't need a separate sign-up step.
      const user = await tx.user.upsert({
        where: { username },
        update: {},
        create: { username },
      });

      const drop = await tx.drop.findUnique({ where: { id: dropId } });

      if (!drop) {
        const err = new Error('Drop not found.');
        err.statusCode = 404;
        throw err;
      }

      if (!isActiveWindow(drop, now)) {
        const err = new Error('Drop is not active.');
        err.statusCode = 409;
        throw err;
      }

      const existing = await tx.reservation.findFirst({
        where: {
          dropId,
          userId: user.id,
          status: ReservationStatus.ACTIVE,
          expiresAt: { gt: now },
        },
      });

      if (existing) {
        const err = new Error('User already has an active reservation for this drop.');
        err.statusCode = 409;
        err.payload = existing;
        throw err;
      }

      // Atomic stock decrement — only succeeds if stock > 0 AND window is open.
      const updated = await tx.drop.updateMany({
        where: {
          id: dropId,
          availableStock: { gt: 0 },
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        data: { availableStock: { decrement: 1 } },
      });

      if (updated.count === 0) {
        const err = new Error('Item is out of stock.');
        err.statusCode = 409;
        throw err;
      }

      return tx.reservation.create({
        data: { dropId, userId: user.id, expiresAt },
      });
    });

    scheduleReservationExpiration(reservation.id, reservation.expiresAt);

    await emitDropUpdate(dropId, 'reservation.created', {
      reservationId: reservation.id,
      username,
      expiresAt: reservation.expiresAt,
    });

    res.status(201).json({
      id: reservation.id,
      dropId,
      username,
      status: reservation.status,
      reservedAt: reservation.reservedAt,
      expiresAt: reservation.expiresAt,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    const payload = error.payload
      ? {
          reservation: {
            id: error.payload.id,
            dropId: error.payload.dropId,
            status: error.payload.status,
            reservedAt: error.payload.reservedAt,
            expiresAt: error.payload.expiresAt,
          },
        }
      : {};

    console.error('Error creating reservation:', error);
    res.status(status).json({ error: error.message || 'Failed to reserve item.', ...payload });
  }
}

module.exports = { handleReserve };
