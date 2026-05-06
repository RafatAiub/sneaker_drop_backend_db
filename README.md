# Sneaker Drop Backend

This is a real-time inventory system designed to handle high-traffic limited edition drops without overselling.

## How to run the app (including SQL schema setup)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up the database:**
   Create a `.env` file in the root directory and add your PostgreSQL database URL:
   ```env
   DATABASE_URL="your_postgresql_url_here"
   ```

3. **Apply the SQL schema:**
   Run the following commands to set up your database tables and generate the Prisma client:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

4. **Seed the database (Optional):**
   If you want to start with some sample sneaker drops, run:
   ```bash
   npx prisma db seed
   ```

5. **Start the server:**
   ```bash
   npm run dev
   ```

## Architecture Choice: How did you handle the 60-second expiration logic?

We used a **two-layer expiration system** to ensure stock is returned quickly and reliably if a user doesn't complete their purchase:

1. **In-Memory Timers (Primary):** The moment a user reserves an item, we start a `setTimeout` timer in the Node.js process. This handles the expiration instantly at the exactly 60-second mark, providing a fast and snappy user experience.
2. **Database Sweep (Safety Net):** We also run a background process every 5 seconds that queries the database for any reservations where the `expiresAt` time has passed but the status is still "ACTIVE". This acts as a reliable fallback just in case the server restarts or an in-memory timer gets missed.

## Concurrency: How did you prevent multiple users from claiming the same last item?

We prevented overselling by using **Atomic Database Transactions** at the database level, rather than relying on application-level checks.

Instead of checking the stock and then updating it later (which creates a race condition if two people check at the exact same millisecond), we use a single update query with a strict condition:

```javascript
where: { 
  id: dropId, 
  availableStock: { gt: 0 } 
}
```

This tells the database: "Decrement the stock by 1, but *only* if the available stock is strictly greater than 0 right now." Because modern databases process these row updates atomically, if 100 people click "Reserve" at the exact same time for the very last pair of sneakers, the database will only allow one update to actually succeed. The other 99 requests will see that 0 rows were updated, and our code safely returns a "Sold Out" error to them.
