import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { z, ZodError } from 'zod';
import type { ChatRepository } from './db.js';
import type { MessageRepository } from './messages.js';
import { HttpError } from './errors.js';
const userId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const documentId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().trim().min(1).max(4000);
const chatId = z.string().uuid();
export interface Dependencies {
  chats: Pick<
    ChatRepository,
    | 'register'
    | 'createDirect'
    | 'requireMember'
    | 'list'
    | 'createGroup'
    | 'changeMember'
  >;
  messages: Pick<
    MessageRepository,
    | 'send'
    | 'list'
    | 'markRead'
    | 'receipts'
    | 'lastSeen'
    | 'getLastSeen'
    | 'edit'
  >;
  authenticate: (
    authorization: string | undefined,
    devUser: string | undefined,
  ) => Promise<string>;
}
export function createApp(deps: Dependencies) {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(async (req, res, next) => {
    res.locals.userId = userId.parse(
      await deps.authenticate(req.get('authorization'), req.get('x-user-id')),
    );
    next();
  });
  function identity(actual: unknown, expected: string) {
    if (actual !== expected)
      throw new HttpError(403, 'User ID must match authenticated user');
  }
  app.post('/users', async (req, res) => {
    const body = z
      .object({ userId, name: z.string().trim().min(1).max(100) })
      .strict()
      .parse(req.body);
    identity(res.locals.userId, body.userId);
    await deps.chats.register(body.userId, body.name);
    res.status(200).json(body);
  });
  app.post('/chat/create', async (req, res) => {
    const body = z
      .object({ userAId: userId, userBId: userId })
      .strict()
      .parse(req.body);
    identity(res.locals.userId, body.userAId);
    if (body.userAId === body.userBId)
      throw new HttpError(400, 'Direct chats need two different users');
    res.json({
      chatId: await deps.chats.createDirect(body.userAId, body.userBId),
    });
  });
  app.post('/chat/group', async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        memberIds: z.array(userId).min(1).max(99),
      })
      .strict()
      .parse(req.body);
    const actor = String(res.locals.userId);
    if (!body.memberIds.some((id) => id !== actor))
      throw new HttpError(400, 'Group needs another member');
    res
      .status(201)
      .json({
        chatId: await deps.chats.createGroup(actor, body.name, body.memberIds),
      });
  });
  app.get('/user/:userId/chats', async (req, res) => {
    const id = userId.parse(req.params.userId);
    identity(res.locals.userId, id);
    res.json({ chats: await deps.chats.list(id) });
  });
  app.use('/chat/:chatId', async (req, res, next) => {
    const id = chatId.parse(req.params.chatId);
    await deps.chats.requireMember(id, String(res.locals.userId));
    res.locals.chatId = id;
    next();
  });
  app.post('/chat/:chatId/message/send', async (req, res) => {
    const body = z.object({ senderId: userId, text }).strict().parse(req.body);
    identity(res.locals.userId, body.senderId);
    res
      .status(201)
      .json(
        await deps.messages.send(
          String(res.locals.chatId),
          body.senderId,
          body.text,
        ),
      );
  });
  app.get('/chat/:chatId/messages', async (req, res) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        before: documentId.optional(),
      })
      .strict()
      .parse(req.query);
    res.json(
      await deps.messages.list(
        String(res.locals.chatId),
        query.limit,
        query.before,
      ),
    );
  });
  app.post('/chat/:chatId/message/:messageId/read', async (req, res) => {
    const body = z.object({ userId }).strict().parse(req.body);
    identity(res.locals.userId, body.userId);
    await deps.messages.markRead(
      String(res.locals.chatId),
      documentId.parse(req.params.messageId),
      body.userId,
    );
    res.sendStatus(204);
  });
  app.get('/chat/:chatId/message/:messageId/receipts', async (req, res) => {
    res.json({
      receipts: await deps.messages.receipts(
        String(res.locals.chatId),
        documentId.parse(req.params.messageId),
      ),
    });
  });
  app.post('/chat/:chatId/lastseen', async (req, res) => {
    const body = z
      .object({ userId, messageId: documentId })
      .strict()
      .parse(req.body);
    identity(res.locals.userId, body.userId);
    await deps.messages.lastSeen(
      String(res.locals.chatId),
      body.userId,
      body.messageId,
    );
    res.sendStatus(204);
  });
  app.get('/chat/:chatId/lastseen', async (_req, res) => {
    res.json({
      lastSeen: await deps.messages.getLastSeen(String(res.locals.chatId)),
    });
  });
  app.patch('/chat/:chatId/message/:messageId', async (req, res) => {
    const body = z.object({ senderId: userId, text }).strict().parse(req.body);
    identity(res.locals.userId, body.senderId);
    await deps.messages.edit(
      String(res.locals.chatId),
      documentId.parse(req.params.messageId),
      body.senderId,
      body.text,
    );
    res.sendStatus(204);
  });
  app.delete('/chat/:chatId/message/:messageId', async (req, res) => {
    await deps.messages.edit(
      String(res.locals.chatId),
      documentId.parse(req.params.messageId),
      String(res.locals.userId),
      null,
    );
    res.sendStatus(204);
  });
  app.post('/chat/:chatId/members', async (req, res) => {
    const body = z.object({ userId }).strict().parse(req.body);
    await deps.chats.changeMember(
      String(res.locals.chatId),
      String(res.locals.userId),
      body.userId,
      false,
    );
    res.sendStatus(204);
  });
  app.delete('/chat/:chatId/members/:userId', async (req, res) => {
    await deps.chats.changeMember(
      String(res.locals.chatId),
      String(res.locals.userId),
      userId.parse(req.params.userId),
      true,
    );
    res.sendStatus(204);
  });
  app.use((_req, _res, next) => next(new HttpError(404, 'Route not found')));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ error: 'Invalid input', details: error.flatten() });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(errors);
  return app;
}
