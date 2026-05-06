'use strict';

const prisma = require('../config/prisma');
const { parseUsername } = require('../utils/parsers');

/**
 * POST /api/users
 *
 * Upserts a user by username (idempotent — safe to call multiple times).
 */
async function createUser(req, res) {
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
}

module.exports = { createUser };
