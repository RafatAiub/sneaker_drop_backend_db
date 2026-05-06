'use strict';

const prisma = require('../config/prisma');

/**
 * Returns true if a drop is within its active time window.
 * @param {{ startsAt: Date, endsAt: Date|null }} drop
 * @param {Date} [now]
 * @returns {boolean}
 */
function isActiveWindow(drop, now = new Date()) {
  return drop.startsAt <= now && (!drop.endsAt || drop.endsAt > now);
}

/**
 * Shapes a raw Prisma Drop record (with purchases + user) into the API response format.
 * @param {object} drop
 * @returns {object}
 */
function formatDrop(drop) {
  return {
    id: drop.id,
    name: drop.name,
    priceInCents: drop.priceInCents,
    price: drop.priceInCents / 100,
    totalStock: drop.totalStock,
    availableStock: drop.availableStock,
    startsAt: drop.startsAt,
    endsAt: drop.endsAt,
    createdAt: drop.createdAt,
    updatedAt: drop.updatedAt,
    latestPurchasers: (drop.purchases || []).map((purchase) => ({
      purchaseId: purchase.id,
      username: purchase.user.username,
      purchasedAt: purchase.purchasedAt,
    })),
  };
}

/**
 * Fetches a single drop by ID and returns the formatted snapshot,
 * or null if the drop does not exist.
 * @param {number} dropId
 * @returns {Promise<object|null>}
 */
async function getDropSnapshot(dropId) {
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: {
      purchases: {
        orderBy: { purchasedAt: 'desc' },
        take: 3,
        include: { user: true },
      },
    },
  });

  return drop ? formatDrop(drop) : null;
}

/**
 * Lists all drops, optionally filtered to only those currently active.
 * @param {boolean} activeOnly
 * @returns {Promise<object[]>}
 */
async function listDrops(activeOnly) {
  const now = new Date();

  const drops = await prisma.drop.findMany({
    where: activeOnly
      ? {
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        }
      : undefined,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    include: {
      purchases: {
        orderBy: { purchasedAt: 'desc' },
        take: 3,
        include: { user: true },
      },
    },
  });

  return drops.map(formatDrop);
}

module.exports = { isActiveWindow, formatDrop, getDropSnapshot, listDrops };
