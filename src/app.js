'use strict';

const express = require('express');
const routes = require('./routes');

const app = express();

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());

// ── CORS (permissive — tighten in production) ─────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', routes);

module.exports = app;
