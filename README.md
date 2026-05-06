# 👟 Sneaker Drop Backend

Real-time, high-traffic limited-edition inventory system built for reliability and scale. This backend manages drop scheduling, atomic reservations, and live stock synchronization using **Node.js**, **Express**, **PostgreSQL (Neon)**, **Prisma**, and **Socket.IO**.

---

## 🚀 Live Deployment

- **API Base URL:** [https://sneaker-drop-backend-db.vercel.app](https://sneaker-drop-backend-db.vercel.app)
- **Health Check:** [https://sneaker-drop-backend-db.vercel.app/health](https://sneaker-drop-backend-db.vercel.app/health)
- **Frontend Link:** [https://sneaker-frontend-lilac.vercel.app/](https://sneaker-frontend-lilac.vercel.app/)

---

## 🛠️ Industry-Level Architecture

The codebase has been refactored into a clean, modular structure following industry best practices:

```text
sneaker-drop/
├── src/
│   ├── app.js              # Express app & middleware configuration
│   ├── config/
│   │   └── prisma.js       # PrismaClient singleton for connection pooling
│   ├── controllers/        # HTTP request handlers (thin layer)
│   ├── routes/             # Route definitions & resource grouping
│   ├── services/           # Core business logic & database transactions
│   ├── sockets/            # Real-time event handling & socket initialization
│   └── utils/              # Pure utility functions & input validators
└── server.js               # Clean entry point for bootstrapping & shutdown
```

---

## 🏗️ Technical Highlights

- **Atomic Reservations:** Uses transactional `updateMany` with inventory guards to prevent overselling.
- **Smart Expiration:** Each reservation is handled by a distributed-safe combination of memory timers and a database sweep safety net.
- **Real-Time Sync:** Socket.IO broadcasts stock changes, reservation alerts, and purchase activity to all clients instantly.
- **Database:** Hosted on **Neon PostgreSQL** with Prisma ORM for type-safe queries and reliable migrations.

---

## 🚥 Main API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/drops` | `GET` | Fetch active drops with live stock & latest purchasers |
| `/api/drops` | `POST` | Create a new product drop |
| `/api/reservations` | `POST` | Reserve an item (60-second window) |
| `/api/purchases` | `POST` | Finalize purchase from an active reservation |
| `/api/users` | `POST` | Create or upsert a user |
| `/health` | `GET` | System health check |

---

## 💻 Local Development

1. **Clone & Install:**
   ```bash
   npm install
   ```

2. **Environment Setup:**
   Create a `.env` file:
   ```env
   DATABASE_URL="your_postgresql_url"
   PORT=3000
   ```

3. **Prisma Setup:**
   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

4. **Start Server:**
   ```bash
   npm run dev
   ```

---

## 📡 Socket Events

- `drops:snapshot`: Initial state push on connection.
- `drop:created`: Broadcast when a new drop is launched.
- `drop:update`: Real-time delta updates for stock levels and activity feeds.

---

## 🛡️ License
ISC
