import 'dotenv/config';
import { z } from 'zod';
const env = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().url(),
    FIREBASE_PROJECT_ID: z.string().min(1),
    DEV_AUTH: z.enum(['true', 'false']).default('false'),
    FIRESTORE_EMULATOR_HOST: z.string().optional(),
  })
  .parse(process.env);
if (
  env.NODE_ENV === 'production' &&
  (env.DEV_AUTH === 'true' || env.FIRESTORE_EMULATOR_HOST)
) {
  throw new Error(
    'Production forbids development authentication and Firestore emulator',
  );
}
export const config = env;
