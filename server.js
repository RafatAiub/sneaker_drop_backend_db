const express = require('express');
const { PrismaClient } = require('@prisma/client');  // Fix here
const prisma = new PrismaClient();  // Initialize PrismaClient
const app = express();
const port = 3000;

app.get('/items', async (req, res) => {
  const items = await prisma.item.findMany();  // Fetch items from the database
  res.json(items);
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

async function main() {
  const items = await prisma.item.findMany();  // Fetch items from the database
  console.log(items);

  //Insert a new item 
  const newItem = await prisma.item.create({
    data: {
      name : 'Sample Item',
      price: 29.99,
      stock:50
    },
    
  });

  console.log(newItem);
}

main()
  .catch(e => {
    throw e;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });