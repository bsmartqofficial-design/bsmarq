# BsmartQ

AI-powered smart queue and appointment management system built with Express, EJS, PostgreSQL, and Socket.IO.

## Run locally

1. Copy `.env.example` to `.env` and adjust the database values if needed.
2. Install dependencies: `npm install`
3. Create the PostgreSQL database `smartq`, then run `database/schema.sql`.
4. Start the app: `npm start`
5. Open `http://localhost:3000`.

## Render deployment

This project is ready for Render as a Node.js web service.

1. Create a PostgreSQL database on Render.
2. Add these environment variables in the Render service:
   - `PORT` (Render sets this automatically)
   - `NODE_ENV=production`
   - `SESSION_SECRET` (a long random string)
   - `DATABASE_URL` (Render PostgreSQL internal connection string)
   - `SUPER_ADMIN_EMAIL=buay@admin.com`
   - `SUPER_ADMIN_PASSWORD=buay102026`
   - `GEMINI_API_KEY` (optional, for BsmartQ AI)
   - `GEMINI_MODEL=gemini-2.0-flash`
3. Build command: `npm install`
4. Start command: `npm start`
5. Before the first deploy, run `npm run db:init` once against the Render database, or execute `database/schema.sql` there. `db:init` also creates the demo organization and admin accounts.

Render will automatically expose the app on the public URL once the service is live.

## BsmartQ AI

Add `GEMINI_API_KEY` to `.env` to enable the BsmartQ AI assistant. Optionally set `GEMINI_MODEL` to choose a Gemini model. The key stays on the server, and AI requests include only the signed-in organization's queue, service, ticket, statistics, and appointment context.

The UI includes a demo-safe in-memory queue for previewing the core experience before the database is seeded. `/join` is the customer registration flow and `/display` is the public screen.
