import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { Pool } from 'pg';
import { config } from './config.js';
import { createApp } from './app.js';
import { ChatRepository } from './db.js';
import { MessageRepository } from './messages.js';
import { HttpError } from './errors.js';
initializeApp({
  projectId: config.FIREBASE_PROJECT_ID,
  ...(config.FIRESTORE_EMULATOR_HOST
    ? {}
    : { credential: applicationDefault() }),
});
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (error) =>
  console.error('Idle PostgreSQL client error', error),
);
const firestore = getFirestore();
const app = createApp({
  chats: new ChatRepository(pool),
  messages: new MessageRepository(firestore),
  authenticate: async (authorization, devUser) => {
    if (config.DEV_AUTH === 'true' && devUser) return devUser;
    if (!authorization?.startsWith('Bearer '))
      throw new HttpError(401, 'Bearer token required');
    try {
      return (await getAuth().verifyIdToken(authorization.slice(7), true)).uid;
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
  },
});
await pool.query('SELECT 1');
const onListening = () =>
  console.log(`Chat API listening on port ${config.PORT}`);
const server =
  config.DEV_AUTH === 'true'
    ? app.listen(config.PORT, '127.0.0.1', onListening)
    : app.listen(config.PORT, onListening);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(() => {
    void Promise.all([pool.end(), firestore.terminate()])
      .then(() => {
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
