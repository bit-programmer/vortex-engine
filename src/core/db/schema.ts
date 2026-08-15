import { sql } from "drizzle-orm";
import { boolean, date, integer, pgEnum, pgTable, text, time, timestamp, varchar } from "drizzle-orm/pg-core";

// Games
export const gamesTable = pgTable("games", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull().unique(),
  price: integer().default(0),
  images: text().array().notNull().default(sql`'{}'::text[]`),
  gameplays: text().array().notNull().default(sql`'{}'::text[]`),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { precision: 6, withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true }).notNull().defaultNow()
});

export const offerTypeEnum = pgEnum('offer_type', ['EXCLUSIVE', 'INCLUSIVE'])

// Offer
export const offerTable = pgTable("offers", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull().unique(),
  fromTime: time(),
  toTime: time(),
  isActive: boolean("is_active").notNull().default(false),
  offerType: offerTypeEnum("offer_type").default('EXCLUSIVE')
});

export const condObjEnum = pgEnum('condObj', ['amount', 'person', 'game', 'time']);

export const cond = pgEnum('cond', ['=', '%', '>', '<', '<=', '>=']);

export const offerObjEnum = pgEnum('offerObj', ['amount', 'person', 'time']);

// Offer details
export const offerDetailsTable = pgTable("offer_details", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  condObj: condObjEnum("cond_obj"),
  cond: cond(),
  offerObj: offerObjEnum("offer_obj"),
  offerValue: text("offer_value")
});
