import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Games Table Schema
export const gamesTable = pgTable("games", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull().unique(),
  price: integer().default(0),
  images: text().array().notNull().default(sql`'{}'::text[]`),
  gameplays: text().array().notNull().default(sql`'{}'::text[]`),
  active: boolean().notNull().default(false),
  createdAt: timestamp("created_at", { precision: 6, withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true }).notNull().defaultNow()
});
