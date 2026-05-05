const express = require('express');
const { PrismaClient } = require('@prisma/client');
const http = require('http');
const socketIo = require('socket.io');
const prisma = new PrismaClient();
const app = express();
const port = 3000;

// Set up server with Express
const server = http.createServer(app);
const io = socketIo(server);  // Set up Socket.io for real-time communication
const { setTimeout } = require('timers');

// Function to check and expire reservations
async function expireReservations() {
  const expiredReservations = await prisma.reservation.findMany({
    where: {
      expirationTime: { lte: new Date() }, // Expired reservations
      completed: false, // Not purchased
    },
  });

  for (let reservation of expiredReservations) {
    // Restore stock when reservation expires
    await prisma.item.update({
      where: { id: reservation.itemId },
      data: { stock: { increment: 1 } }, // Increment stock by 1
    });

    // Mark reservation as expired
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { completed: true, expired: true },
    });

    // Notify all clients
    io.emit('stockRestored', { itemId: reservation.itemId });

    console.log(`Reservation for item ${reservation.itemId} expired and stock restored`);
  }
}

// Set the expiration check to run every 30 seconds
setInterval(expireReservations, 30 * 1000);  // Check every 30 seconds
app.use(express.json());  // Middleware to parse JSON request bodies 

// Get all items
app.get('/items', async (req, res) => {
  try {
    const items = await prisma.item.findMany();
    res.json(items);
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// Reserve an item
app.post('/reserve', async (req, res) => {
  const { itemId, userId } = req.body;
  
  try {
    const item = await prisma.item.findUnique({ where: { id: itemId } });

    if (item && item.stock > 0) {
      // Begin transaction to reserve the item atomically
      const result = await prisma.$transaction(async (prisma) => {
        // Update stock and mark item as reserved
        const updatedItem = await prisma.item.update({
          where: { id: itemId },
          data: { stock: item.stock - 1 },
        });

        // Insert into reservations table (new model or column)
        await prisma.reservation.create({
          data: {
            itemId: itemId,
            userId: userId,
            reservedAt: new Date(),
            expirationTime: new Date(Date.now() + 60 * 1000), // 60 seconds from now
          },
        });

        return updatedItem;
      });

      // Emit event for real-time update to all clients
      io.emit('itemReserved', { itemId, userId });

      res.status(200).send("Item reserved successfully");
    } else {
      res.status(400).send("Item out of stock");
    }
  } catch (error) {
    console.error("Error reserving item:", error);
    res.status(500).send("Internal server error");
  }
});

// Purchase an item
app.post('/purchase', async (req, res) => {
  const { itemId, userId } = req.body;

  try {
    const reservation = await prisma.reservation.findFirst({
      where: { itemId: itemId, userId: userId, completed: false },
    });

    if (!reservation) {
      return res.status(400).send("You must reserve the item before purchasing.");
    }

    // Process purchase and reduce stock
    await prisma.item.update({
      where: { id: itemId },
      data: { stock: { decrement: 1 } },
    });

    // Mark reservation as completed
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { completed: true },
    });

    res.status(200).send("Purchase successful");
  } catch (error) {
    console.error("Error purchasing item:", error);
    res.status(500).send("Internal server error");
  }
});

// Start Socket.io connection
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});