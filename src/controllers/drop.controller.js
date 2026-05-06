'use strict';

const prisma = require('../config/prisma');
const { parsePositiveInteger, parseFutureDate, parsePriceInCents } = require('../utils/parsers');
const { formatDrop, listDrops } = require('../services/drop.service');
const { sweepExpiredReservations } = require('../services/reservation.service');
const { emitEvent } = require('../sockets/emitter');

/**
 * GET /api/drops  &  GET /items
 * Returns all drops, defaulting to active-only.
 */
async function getDrops(req, res) {
  try {
    await sweepExpiredReservations();
    const activeOnly = req.query.activeOnly !== 'false';
    const drops = await listDrops(activeOnly);
    res.json(drops);
  } catch (error) {
    console.error('Error fetching drops:', error);
    res.status(500).json({ error: 'Failed to fetch drops.' });
  }
}

/**
 * POST /api/drops
 * Creates a new drop and broadcasts the `drop:created` socket event.
 */
async function createDrop(req, res) {
  try {
    const name = String(req.body.name || '').trim();

    if (!name) throw new Error('name is required.');

    const totalStock = parsePositiveInteger(req.body.totalStock, 'totalStock');
    const priceInCents = parsePriceInCents(req.body);
    const startsAt = parseFutureDate(
      req.body.startsAt || new Date().toISOString(),
      'startsAt',
    );
    const endsAt = req.body.endsAt ? parseFutureDate(req.body.endsAt, 'endsAt') : null;

    if (endsAt && endsAt <= startsAt) {
      throw new Error('endsAt must be later than startsAt.');
    }

    const drop = await prisma.drop.create({
      data: {
        name,
        priceInCents,
        totalStock,
        availableStock: totalStock,
        startsAt,
        endsAt,
      },
      include: {
        purchases: {
          orderBy: { purchasedAt: 'desc' },
          take: 3,
          include: { user: true },
        },
      },
    });

    const snapshot = formatDrop(drop);
    emitEvent('drop:created', snapshot);

    res.status(201).json(snapshot);
  } catch (error) {
    const status =
      error.message?.includes('required') || error.message?.includes('must') ? 400 : 500;
    console.error('Error creating drop:', error);
    res.status(status).json({ error: error.message || 'Failed to create drop.' });
  }
}

module.exports = { getDrops, createDrop };
