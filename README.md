# Sneaker Drop Backend

Real-time limited-edition inventory backend using `Node.js`, `Express`, `PostgreSQL`, `Prisma`, and `Socket.IO`.

## Run locally

1. Set `DATABASE_URL` in `.env`.
2. Apply the schema:
   - `npx prisma migrate deploy`
   - `npx prisma generate`
3. Start the API:
   - `node server.js`

Server default: `http://localhost:3000`

## Full local run order

1. In this backend project:
   - `npx prisma migrate deploy`
   - `npx prisma generate`
   - `node server.js`
2. In the frontend project at `C:\Users\azmai\OneDrive\Desktop\live codeing\techzu-task\sneaker-frontend`:
   - `npm install`
   - `npm run dev`
3. Open the frontend at `http://localhost:5173`

## Demo checklist

1. Create a new drop with `POST /api/drops`
2. Open two browser windows side by side on the frontend
3. Reserve in one window and confirm live stock sync in the other
4. Complete purchase and confirm the latest purchaser appears on the card
5. Reserve again with another user and wait 60 seconds
6. Confirm the reservation expires, stock returns, and all connected clients update

## Main endpoints

- `GET /api/drops` — active drops with live stock and top 3 latest purchasers
- `POST /api/drops` — create a new merch drop
- `POST /api/reservations` — reserve one unit for 60 seconds
- `POST /api/purchases` — complete purchase from an active reservation
- `POST /api/users` — create/upsert a user

Compatibility aliases:

- `GET /items`
- `POST /reserve`
- `POST /purchase`

## Sample payloads

Create a drop:

```json
{
  "name": "Air Jordan 1",
  "price": 250,
  "totalStock": 100,
  "startsAt": "2026-05-06T12:00:00.000Z"
}
```

Reserve:

```json
{
  "dropId": 1,
  "username": "azmai"
}
```

Purchase:

```json
{
  "reservationId": "ck_reservation_id",
  "username": "azmai"
}
```

## Architecture notes

- **60-second expiration:** each reservation is scheduled with `setTimeout` for near-real-time recovery, plus a 5-second DB sweep as a safety net after restarts or missed timers.
- **Concurrency control:** reservations use a single transactional `updateMany` with `availableStock > 0`. Only one request can decrement the final unit, which prevents overselling.
- **Purchase correctness:** stock is decremented only on reservation, not again on purchase. Purchase only flips reservation status to `COMPLETED` and records the purchase row.
- **Activity feed:** `GET /api/drops` returns each drop with nested `latestPurchasers`, limited to the 3 most recent successful purchases.

## Socket events

- `drops:snapshot` — sent on connect with the full active-drop list
- `drop:created` — new drop created
- `drop:update` — stock/reservation/purchase changes
