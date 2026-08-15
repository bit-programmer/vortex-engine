import { sql } from "drizzle-orm";
import { boolean, date, integer, pgEnum, pgTable, primaryKey, text, time, timestamp, varchar } from "drizzle-orm/pg-core";
import { SingleStoreBigIntString } from "drizzle-orm/singlestore-core";
import { de } from "zod/v4/locales";

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

// Booking
export const bookingTable = pgTable('booking_tables', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  phoneNumber: text("phone_number").notNull(),
  offers: text("offers").array(),
  originalAmount: integer("original_amount").default(0),
  amountCharged: integer("amount_charged").default(0),
  count: integer().notNull().default(1),
  startTime: timestamp("start_time", { precision: 6, withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { precision: 6, withTimezone: true }).notNull(),
  // games: [],
  // setupId
});

// Booking and offers
export const bookingAndOffersTable = pgTable("booking_offers", {
  bookingId: integer("booking_id"),
  offerId: integer("offer_id"),
}, (table) => ({
  pk: primaryKey({
    columns: [table.bookingId, table.offerId]
  })
}));

// Booking and games
export const bookingAndGames = pgTable("booking_games", {
  bookingId: integer("booking_id"),
  gameId: integer("game_id"),
}, (table) => ({
  pk: primaryKey({
    columns: [table.bookingId, table.gameId]
  })
}));


// Payment table


// Setup


// Testimonials


// Roadmap
