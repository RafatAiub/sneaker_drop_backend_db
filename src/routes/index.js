'use strict';

const { Router } = require('express');
const dropController = require('../controllers/drop.controller');
const reservationController = require('../controllers/reservation.controller');
const purchaseController = require('../controllers/purchase.controller');
const userController = require('../controllers/user.controller');

const router = Router();

// ── Health ──────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => res.json({ ok: true }));

// ── Drops ───────────────────────────────────────────────────────────────────
router.get('/api/drops', dropController.getDrops);
router.post('/api/drops', dropController.createDrop);

// ── Users ───────────────────────────────────────────────────────────────────
router.post('/api/users', userController.createUser);

// ── Reservations ─────────────────────────────────────────────────────────────
router.post('/api/reservations', reservationController.handleReserve);

// ── Purchases ────────────────────────────────────────────────────────────────
router.post('/api/purchases', purchaseController.handlePurchase);

// ── Legacy aliases (keep for backward-compat with existing frontend) ─────────
router.get('/items', dropController.getDrops);
router.post('/reserve', reservationController.handleReserve);
router.post('/purchase', purchaseController.handlePurchase);

module.exports = router;
