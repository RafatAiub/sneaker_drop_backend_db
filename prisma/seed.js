'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Clean existing data (Optional: remove if you want to keep existing data)
  // await prisma.purchase.deleteMany();
  // await prisma.reservation.deleteMany();
  // await prisma.drop.deleteMany();
  // await prisma.user.deleteMany();

  // 2. Create some sample users
  const users = [
    { username: 'sneakerhead_99' },
    { username: 'hypebeast_king' },
    { username: 'resell_guru' },
    { username: 'nike_collector' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: u,
    });
  }

  // 3. Create sample drops
  const now = new Date();
  const pastDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
  const futureDate = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 2 days from now

  const drops = [
    {
      name: 'Air Jordan 1 Retro High OG "Chicago"',
      priceInCents: 18000,
      totalStock: 50,
      availableStock: 48,
      startsAt: pastDate,
    },
    {
      name: 'Travis Scott x Air Jordan 1 Low "Reverse Mocha"',
      priceInCents: 15000,
      totalStock: 25,
      availableStock: 25,
      startsAt: now, // Starting exactly now
    },
    {
      name: 'Nike Dunk Low "Panda"',
      priceInCents: 11000,
      totalStock: 200,
      availableStock: 195,
      startsAt: pastDate,
    },
    {
      name: 'Adidas Yeezy Boost 350 V2 "Onyx"',
      priceInCents: 23000,
      totalStock: 100,
      availableStock: 100,
      startsAt: futureDate, // Upcoming
    },
  ];

  for (const d of drops) {
    await prisma.drop.create({
      data: d,
    });
  }

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
