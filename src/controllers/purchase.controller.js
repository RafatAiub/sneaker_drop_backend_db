'use strict';

const { ReservationStatus } = require('@prisma/client');
const prisma = require('../config/prisma');
const { parsePositiveInteger, parseUsername } = require('../utils/parsers');
const {
  sweepExpiredReservations,
  clearReservationTimer,
} = require('../services/reservation.service');
const { emitDropUpdate } = require('../sockets/emitter');

/**
 * POST /api/purchases  &  POST /purchase  (legacy alias)
 *
 * Converts an ACTIVE, non-expired reservation into a completed Purchase.
 * Uses optimistic locking (updateMany with status + expiresAt guard) to
 * prevent double-completion under concurrency.
 */
async function handlePurchase(req, res) {
  try {
    await sweepExpiredReservations();

    const username = parseUsername(req.body.username ?? req.body.userId);
    const reservationId = req.body.reservationId
      ? String(req.body.reservationId).trim()
      : null;
    const dropId = req.body.dropId ?? req.body.itemId;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { username } });

      if (!user) {
        const err = new Error('User not found.');
        err.statusCode = 404;
        throw err;
      }

      // Support lookup by explicit reservationId OR by most-recent active reservation.
      const reservation = reservationId
        ? await tx.reservation.findUnique({ where: { id: reservationId } })
        : await tx.reservation.findFirst({
            where: {
              dropId: parsePositiveInteger(dropId, 'dropId'),
              userId: user.id,
              status: ReservationStatus.ACTIVE,
            },
            orderBy: { reservedAt: 'desc' },
          });

      if (!reservation || reservation.userId !== user.id) {
        const err = new Error('Active reservation not found for this user.');
        err.statusCode = 404;
        throw err;
      }

      if (reservation.status !== ReservationStatus.ACTIVE) {
        const err = new Error('Reservation is no longer active.');
        err.statusCode = 409;
        throw err;
      }

      if (reservation.expiresAt <= now) {
        const err = new Error('Reservation has expired.');
        err.statusCode = 410;
        throw err;
      }

      // Optimistic lock — only completes if ACTIVE & not yet expired.
      const updated = await tx.reservation.updateMany({
        where: {
          id: reservation.id,
          userId: user.id,
          status: ReservationStatus.ACTIVE,
          expiresAt: { gt: now },
        },
        data: { status: ReservationStatus.COMPLETED, completedAt: now },
      });

      if (updated.count === 0) {
        const err = new Error('Reservation could not be completed.');
        err.statusCode = 409;
        throw err;
      }

      const purchase = await tx.purchase.create({
        data: {
          dropId: reservation.dropId,
          userId: user.id,
          reservationId: reservation.id,
        },
      });

      return {
        reservationId: reservation.id,
        dropId: reservation.dropId,
        purchaseId: purchase.id,
      };
    });

    clearReservationTimer(result.reservationId);

    await emitDropUpdate(result.dropId, 'purchase.completed', {
      reservationId: result.reservationId,
      purchaseId: result.purchaseId,
      username,
    });

    res.status(201).json({
      purchaseId: result.purchaseId,
      reservationId: result.reservationId,
      dropId: result.dropId,
      username,
      status: 'COMPLETED',
    });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('Error creating purchase:', error);
    res.status(status).json({ error: error.message || 'Failed to complete purchase.' });
  }
}

module.exports = { handlePurchase };
