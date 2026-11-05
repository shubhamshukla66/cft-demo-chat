import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { HttpError } from './errors.js';
export class ChatRepository {
  constructor(public readonly pool: Pool) {}
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async register(id: string, name: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO users(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name',
      [id, name],
    );
  }
  async createDirect(a: string, b: string): Promise<string> {
    return this.transaction(async (client) => {
      const users = await client.query(
        'SELECT id FROM users WHERE id = ANY($1::text[])',
        [[a, b]],
      );
      if (users.rowCount !== 2)
        throw new HttpError(404, 'Both users must be registered');
      const key = JSON.stringify([a, b].sort());
      const result = await client.query<{ id: string }>(
        `INSERT INTO chats(id,kind,direct_key,owner_id) VALUES($1,'direct',$2,$3)
        ON CONFLICT(direct_key) DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id`,
        [randomUUID(), key, a],
      );
      const id = result.rows[0]!.id;
      await client.query(
        'INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING',
        [id, a, b],
      );
      return id;
    });
  }
  async requireMember(chatId: string, userId: string): Promise<void> {
    const result = await this.pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [chatId, userId],
    );
    if (!result.rowCount) throw new HttpError(403, 'Chat membership required');
  }
  async list(userId: string): Promise<unknown[]> {
    const result = await this.pool.query(
      `SELECT c.id AS "chatId", c.kind, c.name, c.owner_id AS "ownerId", c.created_at AS "createdAt",
      array_agg(m.user_id ORDER BY m.user_id) AS "memberIds" FROM chats c JOIN chat_members m ON m.chat_id=c.id
      WHERE EXISTS(SELECT 1 FROM chat_members mine WHERE mine.chat_id=c.id AND mine.user_id=$1)
      GROUP BY c.id ORDER BY c.created_at DESC,c.id`,
      [userId],
    );
    return result.rows;
  }
  async createGroup(
    owner: string,
    name: string,
    members: string[],
  ): Promise<string> {
    return this.transaction(async (client) => {
      const ids = [...new Set([owner, ...members])];
      const found = await client.query(
        'SELECT id FROM users WHERE id=ANY($1::text[])',
        [ids],
      );
      if (found.rowCount !== ids.length)
        throw new HttpError(404, 'All members must be registered');
      const id = randomUUID();
      await client.query(
        "INSERT INTO chats(id,kind,name,owner_id) VALUES($1,'group',$2,$3)",
        [id, name, owner],
      );
      await client.query(
        'INSERT INTO chat_members(chat_id,user_id) SELECT $1,unnest($2::text[])',
        [id, ids],
      );
      return id;
    });
  }
  async changeMember(
    chatId: string,
    owner: string,
    userId: string,
    remove: boolean,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const result = await client.query<{ owner_id: string; kind: string }>(
        'SELECT owner_id,kind FROM chats WHERE id=$1 FOR UPDATE',
        [chatId],
      );
      const chat = result.rows[0];
      if (!chat) throw new HttpError(404, 'Chat not found');
      if (chat.kind !== 'group' || chat.owner_id !== owner)
        throw new HttpError(403, 'Group owner required');
      if (remove && userId === owner)
        throw new HttpError(400, 'Cannot remove group owner');
      if (remove)
        await client.query(
          'DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2',
          [chatId, userId],
        );
      else {
        const user = await client.query('SELECT 1 FROM users WHERE id=$1', [
          userId,
        ]);
        if (!user.rowCount) throw new HttpError(404, 'User not found');
        await client.query(
          'INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [chatId, userId],
        );
      }
    });
  }
}
