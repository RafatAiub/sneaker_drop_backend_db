const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PrismaClient, ReservationStatus } = require('./generated/prisma');
const { Server } = require('socket.io');

const envPath = path.join(__dirname, '.env');

if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');

  for (const line of envFile.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const port = Number(process.env.PORT || 3000);
const RESERVATION_WINDOW_MS = 60 * 1000;
const EXPIRATION_SWEEP_MS = 5 * 1000;
const expirationTimers = new Map();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

function isActiveWindow(drop, now = new Date()) {
  return drop.startsAt <= now && (!drop.endsAt || drop.endsAt > now);
}

function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function parseUsername(value) {
  const username = String(value || '').trim();

  if (!username) {
    throw new Error('username is required.');
  }

  if (username.length > 50) {
    throw new Error('username must be 50 characters or fewer.');
  }

  return username;
}

function parseFutureDate(value, fieldName) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO date.`);
  }

  return parsed;
}

function parsePriceInCents(payload) {
  if (payload.priceInCents !== undefined) {
    return parsePositiveInteger(payload.priceInCents, 'priceInCents');
  }

  const numericPrice = Number(payload.price);

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    throw new Error('price must be a positive number.');
  }

  return Math.round(numericPrice * 100);
}

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

  if (!drop) {
    return null;
  }

  return formatDrop(drop);
}

async function emitDropUpdate(dropId, type, extra = {}) {
  const drop = await getDropSnapshot(dropId);

  if (!drop) {
    return;
  }

  io.emit('drop:update', {
    type,
    drop,
    ...extra,
  });
}

function clearReservationTimer(reservationId) {
  const existingTimer = expirationTimers.get(reservationId);

  if (existingTimer) {
    clearTimeout(existingTimer);
    expirationTimers.delete(reservationId);
  }
}

function scheduleReservationExpiration(reservationId, expiresAt) {
  clearReservationTimer(reservationId);

  const delay = Math.max(new Date(expiresAt).getTime() - Date.now(), 0);
  const timer = setTimeout(async () => {
    expirationTimers.delete(reservationId);
    await expireReservationById(reservationId);
  }, delay);

  expirationTimers.set(reservationId, timer);
}

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

    const updatedReservation = await tx.reservation.updateMany({
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

    if (updatedReservation.count === 0) {
      return null;
    }

    const drop = await tx.drop.update({
      where: { id: reservation.dropId },
      data: {
        availableStock: { increment: 1 },
      },
    });

    return {
      reservationId,
      dropId: reservation.dropId,
      username: reservation.user.username,
      availableStock: drop.availableStock,
    };
  });

  if (!result) {
    return null;
  }

  await emitDropUpdate(result.dropId, 'reservation.expired', {
    reservationId: result.reservationId,
    username: result.username,
  });

  return result;
}

async function sweepExpiredReservations() {
  const expiredReservations = await prisma.reservation.findMany({
    where: {
      status: ReservationStatus.ACTIVE,
      expiresAt: { lte: new Date() },
    },
    select: { id: true },
  });

  for (const reservation of expiredReservations) {
    await expireReservationById(reservation.id);
  }
}

async function scheduleExistingReservations() {
  const activeReservations = await prisma.reservation.findMany({
    where: {
      status: ReservationStatus.ACTIVE,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  for (const reservation of activeReservations) {
    scheduleReservationExpiration(reservation.id, reservation.expiresAt);
  }
}

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

async function handleReserve(req, res) {
  try {
    await sweepExpiredReservations();

    const dropId = parsePositiveInteger(req.body.dropId ?? req.body.itemId, 'dropId');
    const username = parseUsername(req.body.username ?? req.body.userId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESERVATION_WINDOW_MS);

    const reservation = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { username },
        update: {},
        create: { username },
      });

      const drop = await tx.drop.findUnique({
        where: { id: dropId },
      });

      if (!drop) {
        const notFoundError = new Error('Drop not found.');
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      if (!isActiveWindow(drop, now)) {
        const inactiveError = new Error('Drop is not active.');
        inactiveError.statusCode = 409;
        throw inactiveError;
      }

      const existingReservation = await tx.reservation.findFirst({
        where: {
          dropId,
          userId: user.id,
          status: ReservationStatus.ACTIVE,
          expiresAt: { gt: now },
        },
      });

      if (existingReservation) {
        const duplicateError = new Error('User already has an active reservation for this drop.');
        duplicateError.statusCode = 409;
        duplicateError.payload = existingReservation;
        throw duplicateError;
      }

      const updatedDrop = await tx.drop.updateMany({
        where: {
          id: dropId,
          availableStock: { gt: 0 },
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        data: {
          availableStock: { decrement: 1 },
        },
      });

      if (updatedDrop.count === 0) {
        const stockError = new Error('Item is out of stock.');
        stockError.statusCode = 409;
        throw stockError;
      }

      return tx.reservation.create({
        data: {
          dropId,
          userId: user.id,
          expiresAt,
        },
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

async function handlePurchase(req, res) {
  try {
    await sweepExpiredReservations();

    const username = parseUsername(req.body.username ?? req.body.userId);
    const reservationId = req.body.reservationId ? String(req.body.reservationId).trim() : null;
    const dropId = req.body.dropId ?? req.body.itemId;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { username },
      });

      if (!user) {
        const userError = new Error('User not found.');
        userError.statusCode = 404;
        throw userError;
      }

      const reservation = reservationId
        ? await tx.reservation.findUnique({
            where: { id: reservationId },
          })
        : await tx.reservation.findFirst({
            where: {
              dropId: parsePositiveInteger(dropId, 'dropId'),
              userId: user.id,
              status: ReservationStatus.ACTIVE,
            },
            orderBy: { reservedAt: 'desc' },
          });

      if (!reservation || reservation.userId !== user.id) {
        const reservationError = new Error('Active reservation not found for this user.');
        reservationError.statusCode = 404;
        throw reservationError;
      }

      if (reservation.status !== ReservationStatus.ACTIVE) {
        const inactiveReservationError = new Error('Reservation is no longer active.');
        inactiveReservationError.statusCode = 409;
        throw inactiveReservationError;
      }

      if (reservation.expiresAt <= now) {
        const expiredError = new Error('Reservation has expired.');
        expiredError.statusCode = 410;
        throw expiredError;
      }

      const updatedReservation = await tx.reservation.updateMany({
        where: {
          id: reservation.id,
          userId: user.id,
          status: ReservationStatus.ACTIVE,
          expiresAt: { gt: now },
        },
        data: {
          status: ReservationStatus.COMPLETED,
          completedAt: now,
        },
      });

      if (updatedReservation.count === 0) {
        const concurrencyError = new Error('Reservation could not be completed.');
        concurrencyError.statusCode = 409;
        throw concurrencyError;
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

app.get('/health', async (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/drops', async (req, res) => {
  try {
    await sweepExpiredReservations();
    const activeOnly = req.query.activeOnly !== 'false';
    const drops = await listDrops(activeOnly);
    res.json(drops);
  } catch (error) {
    console.error('Error fetching drops:', error);
    res.status(500).json({ error: 'Failed to fetch drops.' });
  }
});

app.post('/api/drops', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const totalStock = parsePositiveInteger(req.body.totalStock, 'totalStock');
    const priceInCents = parsePriceInCents(req.body);
    const startsAt = parseFutureDate(req.body.startsAt || new Date().toISOString(), 'startsAt');
    const endsAt = req.body.endsAt ? parseFutureDate(req.body.endsAt, 'endsAt') : null;

    if (!name) {
      throw new Error('name is required.');
    }

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
    io.emit('drop:created', snapshot);

    res.status(201).json(snapshot);
  } catch (error) {
    const status = error.message?.includes('required') || error.message?.includes('must')
      ? 400
      : 500;

    console.error('Error creating drop:', error);
    res.status(status).json({ error: error.message || 'Failed to create drop.' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const username = parseUsername(req.body.username);
    const user = await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username },
    });

    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to create user.' });
  }
});

app.post('/api/reservations', handleReserve);
app.post('/api/purchases', handlePurchase);
app.get('/items', async (_req, res) => {
  try {
    await sweepExpiredReservations();
    const drops = await listDrops(true);
    res.json(drops);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: 'Failed to fetch items.' });
  }
});
app.post('/reserve', handleReserve);
app.post('/purchase', handlePurchase);

io.on('connection', async (socket) => {
  socket.emit('connected', { ok: true });
  socket.emit('drops:snapshot', await listDrops(true));
});

async function start() {
  await sweepExpiredReservations();
  await scheduleExistingReservations();

  const expirationInterval = setInterval(sweepExpiredReservations, EXPIRATION_SWEEP_MS);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

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
