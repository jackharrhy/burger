import { randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { Userinfo } from "./oauth";

export type User = {
  id: string;
  fourmId: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
};

const rowToUser = (row: {
  id: string;
  fourm_id: string;
  username: string;
  display_name: string | null;
  is_admin: number;
}): User => ({
  id: row.id,
  fourmId: row.fourm_id,
  username: row.username,
  displayName: row.display_name,
  isAdmin: row.is_admin === 1,
});

export const upsertUserFromUserinfo = (
  db: Database,
  userinfo: Userinfo,
): User => {
  const existing = db
    .query(
      "SELECT id, fourm_id, username, display_name, is_admin FROM users WHERE fourm_id = ?",
    )
    .get(userinfo.sub) as
    | {
        id: string;
        fourm_id: string;
        username: string;
        display_name: string | null;
        is_admin: number;
      }
    | undefined;

  if (existing) {
    db.run(
      "UPDATE users SET username = ?, display_name = ?, is_admin = ? WHERE id = ?",
      [
        userinfo.username,
        userinfo.display_name ?? null,
        userinfo.is_admin ? 1 : 0,
        existing.id,
      ],
    );
    return rowToUser({
      ...existing,
      username: userinfo.username,
      display_name: userinfo.display_name ?? null,
      is_admin: userinfo.is_admin ? 1 : 0,
    });
  }

  const id = randomBytes(16).toString("base64url");
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      id,
      userinfo.sub,
      userinfo.username,
      userinfo.display_name ?? null,
      userinfo.is_admin ? 1 : 0,
      Date.now(),
    ],
  );
  return {
    id,
    fourmId: userinfo.sub,
    username: userinfo.username,
    displayName: userinfo.display_name ?? null,
    isAdmin: userinfo.is_admin,
  };
};

export const getUserById = (db: Database, id: string): User | null => {
  const row = db
    .query(
      "SELECT id, fourm_id, username, display_name, is_admin FROM users WHERE id = ?",
    )
    .get(id) as
    | {
        id: string;
        fourm_id: string;
        username: string;
        display_name: string | null;
        is_admin: number;
      }
    | undefined;
  return row ? rowToUser(row) : null;
};
