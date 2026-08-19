import { Hono } from 'hono';
import { db } from '../core/db/index.js';
import {
  gamesTable,
  setupsTable,
  setupGamesTable,
  offerTable,
  offerDetailsTable,
  bookingTable,
  bookingAndGames,
  bookingAndOffersTable,
  slotLocksTable,
  bookingSlotsTable
} from '../core/db/schema.js';
import { eq, and, gte, lte, lt, gt, or, ilike, ne } from 'drizzle-orm';
import * as z from 'zod';
import { authMiddleware, requireRole } from '../middlewares/auth.js';
import { verify } from 'hono/jwt';
import env from '../core/env.js';

const api = new Hono();

// Helper function to parse Date and Time String in Asia/Kolkata timezone to a UTC Date object
function parseTimeToDate(dateStr: string, timeStr: string): Date {
  let hour = 0;
  let minute = 0;
  
  const cleanTime = timeStr.trim().toUpperCase();
  const ampmMatch = cleanTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (ampmMatch) {
    hour = parseInt(ampmMatch[1], 10);
    minute = parseInt(ampmMatch[2], 10);
    const ampm = ampmMatch[3];
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  } else {
    const simpleMatch = cleanTime.match(/^(\d{1,2}):(\d{2})$/);
    if (simpleMatch) {
      hour = parseInt(simpleMatch[1], 10);
      minute = parseInt(simpleMatch[2], 10);
    }
  }
  
  const [year, month, day] = dateStr.split('-').map(Number);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const kolkataStr = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
  return new Date(`${kolkataStr}+05:30`);
}

// Validation Schema for Booking creation
const bookingSchema = z.object({
  phoneNumber: z.string().min(5, "Phone number must be valid"),
  setupId: z.number().int().positive("Invalid setup ID"),
  userId: z.number().int().positive().optional(),
  lockToken: z.string().optional(),
  count: z.number().int().positive("Person count must be at least 1"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD"),
  startTime: z.string().min(1, "Start time is required"),
  noOfHours: z.number().int().positive("noOfHours must be at least 1"),
  gameIds: z.array(z.number().int().positive()).optional(),
  appliedOfferIds: z.array(z.number().int().positive()).optional()
});

// 1. GET /api/games - List all active games (supports search via optional query param 'q')
api.get('/games', async (c) => {
  try {
    const query = c.req.query('q');

    let games;
    if (query) {
      games = await db
        .select()
        .from(gamesTable)
        .where(
          and(
            eq(gamesTable.isActive, true),
            ilike(gamesTable.name, `%${query}%`)
          )
        );
    } else {
      games = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.isActive, true));
    }

    return c.json({ success: true, games });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 2. GET /api/setups - List setups with their available games
api.get('/setups', async (c) => {
  try {
    const setups = await db
      .select()
      .from(setupsTable)
      .where(eq(setupsTable.isActive, true));

    const setupGames = await db
      .select({
        setupId: setupGamesTable.setupId,
        game: {
          id: gamesTable.id,
          name: gamesTable.name,
          price: gamesTable.price,
          images: gamesTable.images,
          isActive: gamesTable.isActive
        }
      })
      .from(setupGamesTable)
      .innerJoin(gamesTable, eq(setupGamesTable.gameId, gamesTable.id))
      .where(eq(gamesTable.isActive, true));

    const result = setups.map((setup) => {
      const gamesForSetup = setupGames
        .filter((sg) => sg.setupId === setup.id)
        .map((sg) => sg.game);
      return {
        ...setup,
        games: gamesForSetup
      };
    });

    return c.json({ success: true, setups: result });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 3. GET /api/offers - List all active offers and details
api.get('/offers', async (c) => {
  try {
    const offers = await db
      .select()
      .from(offerTable)
      .where(eq(offerTable.isActive, true));

    const details = await db
      .select()
      .from(offerDetailsTable);

    const result = offers.map((offer) => {
      const offerDetails = details.filter((d) => d.offerId === offer.id);
      return {
        ...offer,
        details: offerDetails
      };
    });

    return c.json({ success: true, offers: result });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Validation schema for offer evaluation and booking review
const reviewSchema = z.object({
  setupId: z.number().int().positive("Invalid setup ID"),
  count: z.number().int().positive("Player count must be at least 1"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD"),
  startTime: z.string().min(1, "Start time is required"),
  noOfHours: z.number().int().positive("noOfHours must be at least 1"),
  gameIds: z.array(z.number().int().positive()).optional(),
  appliedOfferIds: z.array(z.number().int().positive()).optional()
});

// 3b. POST /api/offers/evaluate - Evaluate eligible and ineligible offers based on checkout details (Public)
api.post('/offers/evaluate', async (c) => {
  try {
    const body = await c.req.json();
    const validated = reviewSchema.safeParse(body);
    if (!validated.success) {
      return c.json({ success: false, error: "Validation failed", details: validated.error.format() }, 400);
    }
    const { setupId, count, date, startTime, noOfHours, gameIds, appliedOfferIds } = validated.data;

    // Fetch setup details
    const [setup] = await db.select().from(setupsTable).where(eq(setupsTable.id, setupId));
    if (!setup) return c.json({ success: false, error: "Setup not found" }, 404);

    // Calculate duration in hours
    const durationHours = noOfHours;
    const originalAmount = Math.ceil(durationHours * setup.chargePerPersonPerHour * count);

    // Fetch active offers and details
    const activeOffers = await db.select().from(offerTable).where(eq(offerTable.isActive, true));
    const offerDetails = await db.select().from(offerDetailsTable);

    const evaluatedOffers = activeOffers.map((offer) => {
      const details = offerDetails.filter((d) => d.offerId === offer.id);
      let eligible = true;
      let reason = "Available";
      let discount = 0;

      for (const d of details) {
        if (d.condObj === 'amount') {
          const thresh = d.condValue ? parseFloat(d.condValue) : 0;
          if (d.cond === '>=' && originalAmount < thresh) {
            eligible = false;
            reason = `Requires amount minimum ${thresh}`;
          } else if (d.cond === '>' && originalAmount <= thresh) {
            eligible = false;
            reason = `Requires amount greater than ${thresh}`;
          }
        } else if (d.condObj === 'person') {
          const thresh = d.condValue ? parseInt(d.condValue, 10) : 0;
          if (d.cond === '>=' && count < thresh) {
            eligible = false;
            reason = `Requires at least ${thresh} players`;
          } else if (d.cond === '>' && count <= thresh) {
            eligible = false;
            reason = `Requires greater than ${thresh} players`;
          }
        } else if (d.condObj === 'game') {
          const targetGameId = d.condValue ? parseInt(d.condValue, 10) : 0;
          const hasGame = gameIds && gameIds.includes(targetGameId);
          if (!hasGame) {
            eligible = false;
            reason = `Requires booking game ID ${targetGameId}`;
          }
        }
      }

      if (eligible) {
        for (const d of details) {
          if (d.offerObj === 'amount') {
            const valStr = d.offerValue || "0";
            if (valStr.endsWith('%')) {
              const pct = parseFloat(valStr.slice(0, -1)) / 100;
              discount += Math.ceil(originalAmount * pct);
            } else {
              discount += parseFloat(valStr);
            }
          } else if (d.offerObj === 'person') {
            const freeCount = Math.floor(count / 2);
            const singlePersonShare = durationHours * setup.chargePerPersonPerHour;
            discount += Math.ceil(freeCount * singlePersonShare);
          }
        }
      }

      return {
        id: offer.id,
        name: offer.name,
        eligible,
        discount,
        reason
      };
    });

    return c.json({ success: true, originalAmount, offers: evaluatedOffers });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 3c. POST /api/bookings/review - Review session details, calculate discount, formatting details (Public)
api.post('/bookings/review', async (c) => {
  try {
    const body = await c.req.json();
    const validated = reviewSchema.safeParse(body);
    if (!validated.success) {
      return c.json({ success: false, error: "Validation failed", details: validated.error.format() }, 400);
    }
    const { setupId, count, date, startTime, noOfHours, gameIds, appliedOfferIds } = validated.data;

    // 1. Fetch setup details
    const [setup] = await db.select().from(setupsTable).where(eq(setupsTable.id, setupId));
    if (!setup) return c.json({ success: false, error: "Setup not found" }, 404);

    // 2. Parse and format Date (e.g. Wednesday, 19 August 2026) in Asia/Kolkata
    const minStart = parseTimeToDate(date, startTime);
    const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' };
    const dateFormatted = minStart.toLocaleDateString('en-GB', dateOptions);

    // 3. Format Slots dynamically (e.g. 10:00 AM – 11:00 AM) in Asia/Kolkata
    const formattedSlotStrings: string[] = [];
    for (let i = 0; i < noOfHours; i++) {
      const slotStart = new Date(minStart.getTime() + i * 60 * 60 * 1000);
      const slotEnd = new Date(minStart.getTime() + (i + 1) * 60 * 60 * 1000);
      const startStr = slotStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
      const endStr = slotEnd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
      formattedSlotStrings.push(`${startStr} – ${endStr}`);
    }
    const slotsFormatted = formattedSlotStrings.join(', ');

    // 4. Calculate Durations
    const durationHours = noOfHours;

    // 5. Get Games List
    let gamesList: string[] = [];
    if (gameIds && gameIds.length > 0) {
      const dbGames = await db.select().from(gamesTable);
      gamesList = dbGames.filter(g => gameIds.includes(g.id)).map(g => g.name);
    }

    // 6. Calculate Price Calculations Text (e.g. ₹100 × 2 people × 2 hrs)
    const priceCalculationText = `₹${setup.chargePerPersonPerHour} × ${count} people × ${durationHours} hrs`;

    // 7. Calculate Pricing & Offers
    const originalAmount = Math.ceil(durationHours * setup.chargePerPersonPerHour * count);

    const activeOffers = await db.select().from(offerTable).where(eq(offerTable.isActive, true));
    const offerDetails = await db.select().from(offerDetailsTable);

    let amountCharged = originalAmount;
    const appliedPromotions: Array<{ id: number; name: string; discount: number }> = [];
    const availablePromotions: Array<{ id: number; name: string; reason: string }> = [];

    for (const offer of activeOffers) {
      const details = offerDetails.filter((d) => d.offerId === offer.id);
      let eligible = true;
      let ineligibleReason = "";

      for (const d of details) {
        if (d.condObj === 'amount') {
          const thresh = d.condValue ? parseFloat(d.condValue) : 0;
          if (d.cond === '>=' && originalAmount < thresh) {
            eligible = false;
            ineligibleReason = `Requires amount minimum ${thresh}`;
          } else if (d.cond === '>' && originalAmount <= thresh) {
            eligible = false;
            ineligibleReason = `Requires amount greater than ${thresh}`;
          }
        } else if (d.condObj === 'person') {
          const thresh = d.condValue ? parseInt(d.condValue, 10) : 0;
          if (d.cond === '>=' && count < thresh) {
            eligible = false;
            ineligibleReason = `Requires at least ${thresh} players`;
          } else if (d.cond === '>' && count <= thresh) {
            eligible = false;
            ineligibleReason = `Requires greater than ${thresh} players`;
          }
        } else if (d.condObj === 'game') {
          const targetGameId = d.condValue ? parseInt(d.condValue, 10) : 0;
          const hasGame = gameIds && gameIds.includes(targetGameId);
          if (!hasGame) {
            eligible = false;
            ineligibleReason = `Requires booking game ID ${targetGameId}`;
          }
        }
      }

      if (eligible) {
        let discount = 0;
        for (const d of details) {
          if (d.offerObj === 'amount') {
            const valStr = d.offerValue || "0";
            if (valStr.endsWith('%')) {
              const pct = parseFloat(valStr.slice(0, -1)) / 100;
              discount += Math.ceil(amountCharged * pct);
            } else {
              discount += parseFloat(valStr);
            }
          } else if (d.offerObj === 'person') {
            const freeCount = Math.floor(count / 2);
            const singlePersonShare = durationHours * setup.chargePerPersonPerHour;
            discount += Math.ceil(freeCount * singlePersonShare);
          }
        }

        const isSelected = !appliedOfferIds || appliedOfferIds.includes(offer.id);
        if (discount > 0 && isSelected) {
          amountCharged = Math.max(0, amountCharged - discount);
          appliedPromotions.push({
            id: offer.id,
            name: offer.name,
            discount: discount
          });
          if (offer.offerType === 'EXCLUSIVE') {
            break;
          }
        } else if (discount > 0) {
          availablePromotions.push({
            id: offer.id,
            name: offer.name,
            reason: "Available"
          });
        }
      } else {
        availablePromotions.push({
          id: offer.id,
          name: offer.name,
          reason: ineligibleReason
        });
      }
    }

    const discountApplied = originalAmount - amountCharged;

    return c.json({
      success: true,
      summary: {
        date: dateFormatted,
        slotsFormatted,
        playersCount: count,
        zoneName: setup.name,
        gamesList,
        durationHours,
        priceCalculationText,
        originalAmount,
        discountApplied,
        totalAmount: amountCharged,
        appliedPromotions,
        availablePromotions
      }
    });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 4. POST /api/bookings - Book a slot (Public, optionally links to User)
api.post('/bookings', async (c) => {
  try {
    const body = await c.req.json();
    const result = bookingSchema.safeParse(body);

    if (!result.success) {
      return c.json({ success: false, error: "Validation failed", details: result.error.format() }, 400);
    }

    const { phoneNumber, setupId, userId, count, date, startTime, noOfHours, gameIds, appliedOfferIds } = result.data;

    // 1. Fetch setup details
    const [setup] = await db
      .select()
      .from(setupsTable)
      .where(eq(setupsTable.id, setupId));

    if (!setup) {
      return c.json({ success: false, error: "Setup not found" }, 404);
    }

    if (!setup.isActive) {
      return c.json({ success: false, error: "Setup is currently not active" }, 400);
    }

    const minStart = parseTimeToDate(date, startTime);
    const maxEnd = new Date(minStart.getTime() + noOfHours * 60 * 60 * 1000);
    const durationHours = noOfHours;

    // 2. Calculate Base Pricing
    const originalAmount = Math.ceil(durationHours * setup.chargePerPersonPerHour * count);

    // 3. Fetch active offers and their details to find matching offers
    const activeOffers = await db
      .select()
      .from(offerTable)
      .where(eq(offerTable.isActive, true));

    const offerDetails = await db
      .select()
      .from(offerDetailsTable);

    let amountCharged = originalAmount;
    const appliedOffers: Array<{ id: number; name: string; discount: number }> = [];

    for (const offer of activeOffers) {
      const details = offerDetails.filter((d) => d.offerId === offer.id);
      if (details.length === 0) continue;

      let isApplicable = true;

      // Check all conditions for the offer
      for (const d of details) {
        if (d.condObj === 'amount') {
          const thresh = d.condValue ? parseFloat(d.condValue) : 0;
          if (d.cond === '>' && !(originalAmount > thresh)) isApplicable = false;
          if (d.cond === '>=' && !(originalAmount >= thresh)) isApplicable = false;
        } else if (d.condObj === 'person') {
          const thresh = d.condValue ? parseInt(d.condValue, 10) : 0;
          if (d.cond === '>=' && !(count >= thresh)) isApplicable = false;
          if (d.cond === '>' && !(count > thresh)) isApplicable = false;
        } else if (d.condObj === 'game') {
          const targetGameId = d.condValue ? parseInt(d.condValue, 10) : 0;
          const hasGame = gameIds && gameIds.includes(targetGameId);
          if (!hasGame) isApplicable = false;
        }
      }

      if (isApplicable) {
        let discountAmount = 0;

        // Apply discount based on offer value
        for (const d of details) {
          if (d.offerObj === 'amount') {
            const valStr = d.offerValue || "0";
            if (valStr.endsWith('%')) {
              const pct = parseFloat(valStr.slice(0, -1)) / 100;
              discountAmount += Math.ceil(amountCharged * pct);
            } else {
              discountAmount += parseFloat(valStr);
            }
          } else if (d.offerObj === 'person') {
            const freeCount = Math.floor(count / 2);
            const singlePersonShare = durationHours * setup.chargePerPersonPerHour;
            discountAmount += Math.ceil(freeCount * singlePersonShare);
          }
        }

        const isSelected = !appliedOfferIds || appliedOfferIds.includes(offer.id);
        if (discountAmount > 0 && isSelected) {
          amountCharged = Math.max(0, amountCharged - discountAmount);
          appliedOffers.push({
            id: offer.id,
            name: offer.name,
            discount: discountAmount
          });
          if (offer.offerType === 'EXCLUSIVE') {
            break;
          }
        }
      }
    }

    // 4. Build setup snapshot — frozen config at time of booking
    const setupSnapshot = {
      setupId: setup.id,
      name: setup.name,
      tagline: setup.tagline ?? null,
      description: setup.description ?? null,
      consoleType: setup.consoleType,
      consoleCount: setup.consoleCount,
      chargePerPersonPerHour: setup.chargePerPersonPerHour,
      otherNecessaries: setup.otherNecessaries ?? null,
      snapshotAt: new Date().toISOString()
    };

    // 5. Create the booking entry (associating with userId if provided)
    const [booking] = await db
      .insert(bookingTable)
      .values({
        phoneNumber,
        setupId,
        userId: userId || null,
        count,
        originalAmount,
        amountCharged,
        startTime: minStart,
        endTime: maxEnd,
        requestedStartTime: minStart,
        requestedNoOfHours: noOfHours,
        setupSnapshot
      })
      .returning();

    // 5b. Record each individual slot in bookingSlotsTable
    for (let i = 0; i < noOfHours; i++) {
      const slotStart = new Date(minStart.getTime() + i * 60 * 60 * 1000);
      const slotEnd = new Date(minStart.getTime() + (i + 1) * 60 * 60 * 1000);
      await db
        .insert(bookingSlotsTable)
        .values({
          bookingId: booking.id,
          startTime: slotStart,
          endTime: slotEnd
        });
    }

    // 6. Link games to the booking
    if (gameIds && gameIds.length > 0) {
      for (const gameId of gameIds) {
        await db
          .insert(bookingAndGames)
          .values({
            bookingId: booking.id,
            gameId: gameId
          })
          .catch((err) => {
            console.warn(`Could not link game ID ${gameId} to booking: ${err.message}`);
          });
      }
    }

    // 7. Link applied offers to the booking
    for (const appOffer of appliedOffers) {
      await db
        .insert(bookingAndOffersTable)
        .values({
          bookingId: booking.id,
          offerId: appOffer.id
        })
        .catch((err) => {
          console.warn(`Could not link offer ID ${appOffer.id} to booking: ${err.message}`);
        });
    }

    return c.json({
      success: true,
      booking: {
        ...booking,
        appliedOffers,
        gamesBooked: gameIds || [],
        setupSnapshot
      }
    });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 5. GET /api/bookings - List bookings (Members only see their own, Admin/Super Admin see all)
api.get('/bookings', authMiddleware, async (c) => {
  try {
    const requester = c.get('jwtPayload') as any;
    let bookings;

    if (requester.role === 'MEMBER') {
      bookings = await db
        .select()
        .from(bookingTable)
        .where(eq(bookingTable.userId, requester.id))
        .orderBy(bookingTable.createdAt);
    } else {
      bookings = await db
        .select()
        .from(bookingTable)
        .orderBy(bookingTable.createdAt);
    }

    return c.json({ success: true, bookings });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 5c. PATCH /api/bookings/:id/status - Update booking status (Requires ADMIN or SUPER_ADMIN)
const updateBookingStatusSchema = z.object({
  status: z.enum(['TENTATIVE', 'CONFIRMED', 'CANCELLED'], { message: "Invalid status value" }),
  actualStartTime: z.string().datetime().optional(),
  actualEndTime: z.string().datetime().optional()
});

api.patch('/bookings/:id/status', authMiddleware, requireRole(['ADMIN', 'SUPER_ADMIN']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) {
      return c.json({ success: false, error: "Invalid booking ID" }, 400);
    }

    const body = await c.req.json();
    const validated = updateBookingStatusSchema.safeParse(body);
    if (!validated.success) {
      return c.json({ success: false, error: "Validation failed", details: validated.error.format() }, 400);
    }

    const { status, actualStartTime, actualEndTime } = validated.data;

    // Fetch original booking to check existence
    const [existing] = await db
      .select()
      .from(bookingTable)
      .where(eq(bookingTable.id, id));

    if (!existing) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Update status (and optionally actual session times set by the café owner)
    const [updated] = await db
      .update(bookingTable)
      .set({
        status,
        updatedAt: new Date(),
        ...(actualStartTime ? { actualStartTime: new Date(actualStartTime) } : {}),
        ...(actualEndTime ? { actualEndTime: new Date(actualEndTime) } : {})
      })
      .where(eq(bookingTable.id, id))
      .returning();

    // Fetch related receipt data for frontend invoice/PDF generation
    const games = await db
      .select({ name: gamesTable.name })
      .from(bookingAndGames)
      .innerJoin(gamesTable, eq(bookingAndGames.gameId, gamesTable.id))
      .where(eq(bookingAndGames.bookingId, updated.id));
    const gamesList = games.map(g => g.name);

    const offers = await db
      .select({ id: offerTable.id, name: offerTable.name })
      .from(bookingAndOffersTable)
      .innerJoin(offerTable, eq(bookingAndOffersTable.offerId, offerTable.id))
      .where(eq(bookingAndOffersTable.bookingId, updated.id));

    // Use requestedStartTime + requestedNoOfHours (what the customer booked)
    // Fall back to startTime/endTime if explicit fields are missing
    const sessionStart = updated.requestedStartTime
      ? new Date(updated.requestedStartTime)
      : new Date(updated.startTime);

    const noOfHours = updated.requestedNoOfHours
      ?? Math.round((new Date(updated.endTime).getTime() - new Date(updated.startTime).getTime()) / (1000 * 60 * 60));

    // Prefer frozen snapshot over live setup row so receipt survives future edits
    const snapshot = updated.setupSnapshot as Record<string, any> | null;

    const dateFormatted = sessionStart.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });

    const startTimeFormatted = sessionStart.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const endTime = new Date(sessionStart.getTime() + noOfHours * 60 * 60 * 1000);
    const endTimeFormatted = endTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const chargePerPersonPerHour = snapshot?.chargePerPersonPerHour ?? null;
    const setupName = snapshot?.name ?? (updated.setupId ? `Setup #${updated.setupId}` : 'Unknown Zone');

    const priceCalculationText = chargePerPersonPerHour != null
      ? `₹${chargePerPersonPerHour} × ${updated.count} people × ${noOfHours} hrs`
      : "";

    const discountApplied = (updated.originalAmount || 0) - (updated.amountCharged || 0);

    const appliedPromotions = offers.map(o => ({
      id: o.id,
      name: o.name,
      discount: discountApplied
    }));

    return c.json({
      success: true,
      booking: updated,
      receipt: {
        bookingId: updated.id,
        date: dateFormatted,
        startTime: startTimeFormatted,
        endTime: endTimeFormatted,
        noOfHours,
        playersCount: updated.count,
        zoneName: setupName,
        gamesList,
        priceCalculationText,
        originalAmount: updated.originalAmount,
        discountApplied,
        totalAmount: updated.amountCharged,
        appliedPromotions,
        setupSnapshot: snapshot
      }
    });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Helper function to generate 14 hourly slots from 10:00 AM on dateStr to 12:00 AM (midnight) in IST (UTC+05:30)
function getSlotsForDate(dateStr: string) {
  const slots: Array<{ startTime: Date; endTime: Date }> = [];
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // 10:00 AM IST corresponds to 04:30 AM UTC (10:00 - 05:30)
  const baseDate = new Date(Date.UTC(year, month - 1, day, 4, 30, 0, 0));
  
  for (let i = 0; i < 14; i++) {
    const slotStart = new Date(baseDate.getTime() + i * 60 * 60 * 1000);
    const slotEnd = new Date(baseDate.getTime() + (i + 1) * 60 * 60 * 1000);
    slots.push({ startTime: slotStart, endTime: slotEnd });
  }
  return slots;
}

const slotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD"),
  setupId: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()),
  lockToken: z.string().optional()
});

const lockIntervalSchema = z.object({
  setupId: z.number().int().positive("Invalid setup ID"),
  lockToken: z.string().min(1, "lockToken is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD"),
  startTime: z.string().min(1, "Start time is required"),
  noOfHours: z.number().int().positive("noOfHours must be at least 1")
});

// 5a. GET /api/slots/available - List booked and locked intervals for a setup on a date (Public)
api.get('/slots/available', async (c) => {
  try {
    const query = c.req.query();
    const validated = slotsQuerySchema.safeParse(query);
    if (!validated.success) {
      return c.json({ success: false, error: "Invalid query parameters", details: validated.error.format() }, 400);
    }
    const { date, setupId, lockToken } = validated.data;

    const [setup] = await db.select().from(setupsTable).where(eq(setupsTable.id, setupId));
    if (!setup) {
      return c.json({ success: false, error: "Setup not found" }, 404);
    }

    const dayStart = new Date(`${date}T00:00:00+05:30`);
    const dayEnd = new Date(`${date}T23:59:59+05:30`);

    // Fetch overlapping bookings
    const bookedIntervals = await db
      .select({
        startTime: bookingTable.startTime,
        endTime: bookingTable.endTime
      })
      .from(bookingTable)
      .where(
        and(
          eq(bookingTable.setupId, setupId),
          lt(bookingTable.startTime, dayEnd),
          gt(bookingTable.endTime, dayStart),
          ne(bookingTable.status, 'CANCELLED')
        )
      );

    // Fetch overlapping active locks
    const activeLocks = await db
      .select({
        startTime: slotLocksTable.startTime,
        endTime: slotLocksTable.endTime,
        lockToken: slotLocksTable.lockToken,
        lockedUntil: slotLocksTable.lockedUntil
      })
      .from(slotLocksTable)
      .where(
        and(
          eq(slotLocksTable.setupId, setupId),
          eq(slotLocksTable.slotDate, date),
          gt(slotLocksTable.lockedUntil, new Date())
        )
      );

    const formattedBooked = bookedIntervals.map(b => ({
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      startTimeFormatted: b.startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
      endTimeFormatted: b.endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    }));

    const formattedLocked = activeLocks
      .filter(l => !lockToken || l.lockToken !== lockToken)
      .map(l => ({
        startTime: l.startTime.toISOString(),
        endTime: l.endTime.toISOString(),
        startTimeFormatted: l.startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
        endTimeFormatted: l.endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
        lockedUntil: l.lockedUntil.toISOString()
      }));

    return c.json({
      success: true,
      date,
      setupId,
      bookedIntervals: formattedBooked,
      lockedIntervals: formattedLocked
    });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 5b. POST /api/slots/lock - Temporary lock an interval during checkout (Public, uses anonymous lockToken)
api.post('/slots/lock', async (c) => {
  try {
    const body = await c.req.json();
    const validated = lockIntervalSchema.safeParse(body);
    if (!validated.success) {
      return c.json({ success: false, error: "Validation failed", details: validated.error.format() }, 400);
    }
    const { setupId, lockToken, date, startTime, noOfHours } = validated.data;

    // Check if setup exists
    const [setup] = await db.select().from(setupsTable).where(eq(setupsTable.id, setupId));
    if (!setup) {
      return c.json({ success: false, error: "Setup not found" }, 404);
    }

    const requestedStart = parseTimeToDate(date, startTime);
    const requestedEnd = new Date(requestedStart.getTime() + noOfHours * 60 * 60 * 1000);
    const lockedUntil = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const result = await db.transaction(async (tx) => {
      // 1. Check existing booking overlap
      const [existingBooking] = await tx
        .select()
        .from(bookingTable)
        .where(
          and(
            eq(bookingTable.setupId, setupId),
            lt(bookingTable.startTime, requestedEnd),
            gt(bookingTable.endTime, requestedStart),
            ne(bookingTable.status, 'CANCELLED')
          )
        );
      if (existingBooking) {
        throw new Error(`The requested interval (${startTime} for ${noOfHours} hours) overlaps with an existing booking.`);
      }

      // 2. Check existing active lock overlap by another user/token
      const [existingLock] = await tx
        .select()
        .from(slotLocksTable)
        .where(
          and(
            eq(slotLocksTable.setupId, setupId),
            lt(slotLocksTable.startTime, requestedEnd),
            gt(slotLocksTable.endTime, requestedStart),
            gt(slotLocksTable.lockedUntil, new Date()),
            ne(slotLocksTable.lockToken, lockToken)
          )
        );

      if (existingLock) {
        throw new Error(`The requested interval overlaps with a temporary lock by another user.`);
      }

      // Remove any old locks from same user token to prevent duplicate entries
      await tx
        .delete(slotLocksTable)
        .where(
          and(
            eq(slotLocksTable.setupId, setupId),
            eq(slotLocksTable.lockToken, lockToken)
          )
        );

      // Perform lock
      const [lockRecord] = await tx
        .insert(slotLocksTable)
        .values({
          setupId,
          lockToken,
          slotDate: date,
          startTime: requestedStart,
          endTime: requestedEnd,
          lockedUntil
        })
        .returning();

      return lockRecord;
    });

    return c.json({ success: true, message: "Interval successfully locked for 5 minutes", lock: result });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 400);
  }
});

// 6. POST /api/games - Add a new game (ADMIN or SUPER_ADMIN only)
const gameSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().int().default(0),
  isActive: z.boolean().default(true)
});

api.post('/games', authMiddleware, requireRole(['ADMIN', 'SUPER_ADMIN']), async (c) => {
  try {
    const body = await c.req.json();
    const result = gameSchema.safeParse(body);

    if (!result.success) {
      return c.json({ success: false, error: "Validation failed", details: result.error.format() }, 400);
    }

    const { name, price, isActive } = result.data;

    const [existing] = await db
      .select()
      .from(gamesTable)
      .where(eq(gamesTable.name, name));

    if (existing) {
      return c.json({ success: false, error: "Game already exists" }, 400);
    }

    const [game] = await db
      .insert(gamesTable)
      .values({ name, price, isActive })
      .returning();

    return c.json({ success: true, game });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 7. POST /api/setups - Add a new setup (ADMIN or SUPER_ADMIN only)
const setupSchema = z.object({
  name: z.string().min(1, "Name is required"),
  tagline: z.string().optional(),
  description: z.string().optional(),
  consoleType: z.string().default('PS5'),
  consoleCount: z.number().int().default(1),
  chargePerPersonPerHour: z.number().int().default(0),
  otherNecessaries: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().default(true)
});

api.post('/setups', authMiddleware, requireRole(['ADMIN', 'SUPER_ADMIN']), async (c) => {
  try {
    const body = await c.req.json();
    const result = setupSchema.safeParse(body);

    if (!result.success) {
      return c.json({ success: false, error: "Validation failed", details: result.error.format() }, 400);
    }

    const { name, tagline, description, consoleType, consoleCount, chargePerPersonPerHour, otherNecessaries, isActive } = result.data;

    const [existing] = await db
      .select()
      .from(setupsTable)
      .where(eq(setupsTable.name, name));

    if (existing) {
      return c.json({ success: false, error: "Setup already exists" }, 400);
    }

    const [setup] = await db
      .insert(setupsTable)
      .values({ name, tagline, description, consoleType, consoleCount, chargePerPersonPerHour, otherNecessaries, isActive })
      .returning();

    return c.json({ success: true, setup });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 8. POST /api/offers - Add a new offer (ADMIN or SUPER_ADMIN only)
const offerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  isActive: z.boolean().default(true),
  offerType: z.enum(['EXCLUSIVE', 'INCLUSIVE']).default('EXCLUSIVE')
});

api.post('/offers', authMiddleware, requireRole(['ADMIN', 'SUPER_ADMIN']), async (c) => {
  try {
    const body = await c.req.json();
    const result = offerSchema.safeParse(body);

    if (!result.success) {
      return c.json({ success: false, error: "Validation failed", details: result.error.format() }, 400);
    }

    const { name, isActive, offerType } = result.data;

    const [existing] = await db
      .select()
      .from(offerTable)
      .where(eq(offerTable.name, name));

    if (existing) {
      return c.json({ success: false, error: "Offer already exists" }, 400);
    }

    const [offer] = await db
      .insert(offerTable)
      .values({ name, isActive, offerType })
      .returning();

    return c.json({ success: true, offer });
  } catch (error: any) {
    console.error(error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default api;
