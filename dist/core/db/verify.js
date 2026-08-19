import 'dotenv/config';
import { db } from './index.js';
import { gamesTable, setupsTable, setupGamesTable, offerTable, offerDetailsTable } from './schema.js';
async function verify() {
    const games = await db.select().from(gamesTable);
    const setups = await db.select().from(setupsTable);
    const setupGames = await db.select().from(setupGamesTable);
    const offers = await db.select().from(offerTable);
    const details = await db.select().from(offerDetailsTable);
    console.log("--- DATABASE VERIFICATION ---");
    console.log("Games in DB:", games.map(g => g.name));
    console.log("Setups in DB:", setups.map(s => s.name));
    console.log("Setup-Games mapping count:", setupGames.length);
    console.log("Offers in DB:", offers.map(o => o.name));
    console.log("Offer details count:", details.length);
}
verify().catch(console.error);
