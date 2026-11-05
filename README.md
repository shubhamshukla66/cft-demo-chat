# cft-demo-chat

Chat backend built with Node.js, TypeScript, Express, PostgreSQL, and Firebase Firestore. PostgreSQL stores users, chats, and membership; Firestore stores messages, read receipts, and last-seen state.

## Local setup

Requirements: Node.js 22 or later, npm, PostgreSQL, and Java 21 for the Firestore emulator.

1. Install dependencies and copy the environment template:

   ```bash
   npm ci
   cp .env.example .env
   ```

2. Create a PostgreSQL database (for example, `chat_practice`) and set `DATABASE_URL` in `.env` to your local connection details:

   ```bash
   createdb -h 127.0.0.1 -U postgres chat_practice
   ```

   Keep `NODE_ENV=development`, `DEV_AUTH=true`, and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` for local testing. Set `FIREBASE_PROJECT_ID` to the same project ID used when starting the emulator.

3. Create the database tables:

   ```bash
   npm run db:migrate
   ```

4. Start Firestore in a terminal (this project ID matches `.env.example`):

   ```bash
   npx firebase-tools emulators:start --only firestore --project fir-chat-backend-ba105
   ```

5. Start the API in another terminal:

   ```bash
   npm run dev
   ```

- API: http://127.0.0.1:3000
- Health check: http://127.0.0.1:3000/health
- Firestore emulator: `127.0.0.1:8080`
- Firestore dashboard: http://127.0.0.1:4001/firestore

Keep both processes running. Emulator data is temporary unless exported. To retain it, add `--export-on-exit=./local-firestore-data` to the emulator command; on later runs, also add `--import=./local-firestore-data`.

## Authentication

All routes except `/health` require authentication. With `DEV_AUTH=true`, send an `x-user-id` header such as `x-user-id: alice`. JSON requests also need `Content-Type: application/json`.

With development authentication disabled, send `Authorization: Bearer <Firebase ID token>` and configure Firebase Application Default Credentials. Production requires `DEV_AUTH=false` and no `FIRESTORE_EMULATOR_HOST`.

## API routes

Base URL: `http://127.0.0.1:3000`. Replace `:chatId`, `:messageId`, and `:userId` with actual IDs.

| Method | Route | JSON body / query | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | — | Health check |
| POST | `/users` | `{"userId":"alice","name":"Alice"}` | Register a user |
| POST | `/chat/create` | `{"userAId":"alice","userBId":"bob"}` | Create or retrieve a direct chat |
| POST | `/chat/group` | `{"name":"Team","memberIds":["bob"]}` | Create a group |
| GET | `/user/:userId/chats` | — | List your chats |
| POST | `/chat/:chatId/message/send` | `{"senderId":"alice","text":"Hello"}` | Send a message |
| GET | `/chat/:chatId/messages` | `?limit=50&before=<messageId>` (optional) | List messages |
| POST | `/chat/:chatId/message/:messageId/read` | `{"userId":"bob"}` | Mark a message read |
| GET | `/chat/:chatId/message/:messageId/receipts` | — | List read receipts |
| POST | `/chat/:chatId/lastseen` | `{"userId":"bob","messageId":"..."}` | Update last-seen position |
| GET | `/chat/:chatId/lastseen` | — | List last-seen positions |
| PATCH | `/chat/:chatId/message/:messageId` | `{"senderId":"alice","text":"Updated"}` | Edit your message |
| DELETE | `/chat/:chatId/message/:messageId` | — | Soft-delete your message |
| POST | `/chat/:chatId/members` | `{"userId":"carol"}` | Add a group member |
| DELETE | `/chat/:chatId/members/:userId` | — | Remove a group member |

Register users before creating chats. Chat routes require membership; group membership changes require the group owner. User and sender IDs in requests must match the authenticated user where applicable. Messages accept 1–4,000 characters after trimming.

Sending messages and creating groups return `201`; successful edits, deletion, read updates, last-seen updates, and membership changes return `204`. Message listing returns `{messages, nextCursor}`; pass `nextCursor` as `before` to fetch older messages. The default limit is 50, with a maximum of 100.

## Other commands
```bash
npm run typecheck  # Check TypeScript
npm run build      # Compile to dist/
npm start          # Run the compiled server (build first)
```
