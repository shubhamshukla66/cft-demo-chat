import {
  FieldPath,
  FieldValue,
  Firestore,
  Timestamp,
  type DocumentSnapshot,
} from 'firebase-admin/firestore';
import { z } from 'zod';
import { HttpError } from './errors.js';
const storedMessage = z.object({
  senderId: z.string(),
  text: z.string(),
  createdAt: z.instanceof(Timestamp),
  editedAt: z.instanceof(Timestamp).nullable(),
  deleted: z.boolean(),
});
export function comparePosition(
  a: Timestamp,
  aId: string,
  b: Timestamp,
  bId: string,
): number {
  return (
    a.seconds - b.seconds ||
    a.nanoseconds - b.nanoseconds ||
    (aId < bId ? -1 : aId > bId ? 1 : 0)
  );
}
function serialize(snapshot: DocumentSnapshot) {
  const data = storedMessage.parse(snapshot.data());
  return {
    messageId: snapshot.id,
    ...data,
    createdAt: data.createdAt.toDate().toISOString(),
    editedAt: data.editedAt?.toDate().toISOString() ?? null,
  };
}
export class MessageRepository {
  constructor(private readonly db: Firestore) {}
  private messages(chatId: string) {
    return this.db.collection('chats').doc(chatId).collection('messages');
  }
  async send(chatId: string, senderId: string, text: string) {
    const ref = this.messages(chatId).doc();
    await ref.create({
      senderId,
      text,
      createdAt: FieldValue.serverTimestamp(),
      editedAt: null,
      deleted: false,
    });
    return serialize(await ref.get());
  }
  async list(chatId: string, limit: number, before?: string) {
    let query = this.messages(chatId)
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (before) {
      const cursor = await this.messages(chatId).doc(before).get();
      if (!cursor.exists)
        throw new HttpError(404, 'Cursor message not found in chat');
      query = query.startAfter(cursor);
    }
    const snapshot = await query.limit(limit + 1).get();
    const page = snapshot.docs.slice(0, limit);
    const nextCursor = snapshot.docs.length > limit ? page.at(-1)!.id : null;
    return { messages: page.reverse().map(serialize), nextCursor };
  }
  async markRead(
    chatId: string,
    messageId: string,
    userId: string,
  ): Promise<void> {
    const message = this.messages(chatId).doc(messageId);
    const receipt = message.collection('readReceipts').doc(userId);
    await this.db.runTransaction(async (tx) => {
      const [doc, existing] = await Promise.all([
        tx.get(message),
        tx.get(receipt),
      ]);
      if (!doc.exists) throw new HttpError(404, 'Message not found in chat');
      if (!existing.exists)
        tx.create(receipt, { userId, readAt: FieldValue.serverTimestamp() });
    });
  }
  async receipts(chatId: string, messageId: string) {
    const message = this.messages(chatId).doc(messageId);
    if (!(await message.get()).exists)
      throw new HttpError(404, 'Message not found in chat');
    const result = await message.collection('readReceipts').get();
    return result.docs.map((doc) => {
      const data = z
        .object({ userId: z.string(), readAt: z.instanceof(Timestamp) })
        .parse(doc.data());
      return {
        userId: data.userId,
        readAt: data.readAt.toDate().toISOString(),
      };
    });
  }
  async lastSeen(
    chatId: string,
    userId: string,
    messageId: string,
  ): Promise<void> {
    const message = this.messages(chatId).doc(messageId);
    const state = this.db
      .collection('chats')
      .doc(chatId)
      .collection('lastSeen')
      .doc(userId);
    await this.db.runTransaction(async (tx) => {
      const [doc, current] = await Promise.all([
        tx.get(message),
        tx.get(state),
      ]);
      if (!doc.exists) throw new HttpError(404, 'Message not found in chat');
      const data = storedMessage.parse(doc.data());
      if (current.exists) {
        const previous = z
          .object({
            messageId: z.string(),
            messageCreatedAt: z.instanceof(Timestamp),
          })
          .parse(current.data());
        if (
          comparePosition(
            data.createdAt,
            messageId,
            previous.messageCreatedAt,
            previous.messageId,
          ) <= 0
        )
          return;
      }
      tx.set(state, {
        userId,
        messageId,
        messageCreatedAt: data.createdAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  async getLastSeen(chatId: string) {
    const result = await this.db
      .collection('chats')
      .doc(chatId)
      .collection('lastSeen')
      .get();
    return result.docs.map((doc) => {
      const data = z
        .object({
          userId: z.string(),
          messageId: z.string(),
          updatedAt: z.instanceof(Timestamp),
        })
        .parse(doc.data());
      return { ...data, updatedAt: data.updatedAt.toDate().toISOString() };
    });
  }
  async edit(
    chatId: string,
    messageId: string,
    senderId: string,
    text: string | null,
  ): Promise<void> {
    const ref = this.messages(chatId).doc(messageId);
    await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) throw new HttpError(404, 'Message not found in chat');
      const data = storedMessage.parse(doc.data());
      if (data.senderId !== senderId)
        throw new HttpError(403, 'Only the sender can change this message');
      if (data.deleted) throw new HttpError(409, 'Message already deleted');
      tx.update(ref, {
        text: text ?? '',
        deleted: text === null,
        editedAt: FieldValue.serverTimestamp(),
      });
    });
  }
}
