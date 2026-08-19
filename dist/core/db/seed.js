import 'dotenv/config';
import { db } from './index.js';
import { gamesTable, setupsTable, setupGamesTable, offerTable, offerDetailsTable, usersTable } from './schema.js';
import { eq } from 'drizzle-orm';
import { hashPassword } from './../../middlewares/auth.js';
async function seed() {
    console.log('Seeding database...');
    // 1. Seed Games
    const gamesList = [
        { name: 'FC 26', price: 0, isActive: true },
        { name: 'Wwe 2k26', price: 0, isActive: true },
        { name: 'Cricket24', price: 0, isActive: true },
        { name: 'Tekken8', price: 0, isActive: true },
        { name: 'GTA 5', price: 0, isActive: true },
        { name: 'Uncharted', price: 0, isActive: true },
        { name: 'Mortal Kombat', price: 0, isActive: true }
    ];
    console.log('Inserting games...');
    const seededGames = {};
    for (const game of gamesList) {
        // Check if game already exists
        const existing = await db
            .select()
            .from(gamesTable)
            .where(eq(gamesTable.name, game.name));
        if (existing.length > 0) {
            console.log(`Game "${game.name}" already exists.`);
            seededGames[game.name] = existing[0].id;
        }
        else {
            const [inserted] = await db
                .insert(gamesTable)
                .values({
                name: game.name,
                price: game.price,
                isActive: game.isActive
            })
                .returning({ id: gamesTable.id });
            console.log(`Inserted game "${game.name}" with ID: ${inserted.id}`);
            seededGames[game.name] = inserted.id;
        }
    }
    // 2. Seed Setups
    const setupsList = [
        {
            name: 'Big Screen (65")',
            tagline: 'Ultra premium gaming on a massive 65" Sansui display',
            description: 'Featuring a big 65" screen setup equipped with PS5 consoles, comfortable chairs, high-end controllers, and immersive sound.',
            consoleType: 'PS5',
            consoleCount: 1,
            chargePerPersonPerHour: 150,
            isActive: true,
            otherNecessaries: {
                headphones: 'Sony WH-CH520 Wireless',
                controllersPerConsole: 2,
                seating: 'Ergonomic Gaming Chairs',
                screenBrand: 'Sansui',
                screenSize: '65 inch'
            }
        },
        {
            name: 'Standard Screen (55")',
            tagline: 'Standard premium gaming zone with 55" Sansui screens',
            description: 'Featuring standard 55" screen setups connected to PS5 consoles, perfect for multiplayer co-op sessions.',
            consoleType: 'PS5',
            consoleCount: 4,
            chargePerPersonPerHour: 100,
            isActive: true,
            otherNecessaries: {
                headphones: 'Standard Wired Headphones',
                controllersPerConsole: 2,
                seating: 'Comfortable Beanbags',
                screenBrand: 'Sansui',
                screenSize: '55 inch'
            }
        }
    ];
    console.log('Inserting setups...');
    const seededSetups = {};
    for (const setup of setupsList) {
        const existing = await db
            .select()
            .from(setupsTable)
            .where(eq(setupsTable.name, setup.name));
        if (existing.length > 0) {
            console.log(`Setup "${setup.name}" already exists — updating configurations...`);
            seededSetups[setup.name] = existing[0].id;
            await db
                .update(setupsTable)
                .set({
                tagline: setup.tagline,
                description: setup.description,
                consoleType: setup.consoleType,
                consoleCount: setup.consoleCount,
                chargePerPersonPerHour: setup.chargePerPersonPerHour,
                otherNecessaries: setup.otherNecessaries,
                updatedAt: new Date()
            })
                .where(eq(setupsTable.name, setup.name));
        }
        else {
            const [inserted] = await db
                .insert(setupsTable)
                .values({
                name: setup.name,
                tagline: setup.tagline,
                description: setup.description,
                consoleType: setup.consoleType,
                consoleCount: setup.consoleCount,
                chargePerPersonPerHour: setup.chargePerPersonPerHour,
                otherNecessaries: setup.otherNecessaries,
                isActive: setup.isActive
            })
                .returning({ id: setupsTable.id });
            console.log(`Inserted setup "${setup.name}" with ID: ${inserted.id}`);
            seededSetups[setup.name] = inserted.id;
        }
    }
    // 3. Associate Games with Setups (Setup Games)
    console.log('Associating games with setups...');
    const set1Games = [
        'FC 26',
        'Wwe 2k26',
        'Cricket24',
        'Tekken8',
        'GTA 5',
        'Uncharted',
        'Mortal Kombat'
    ];
    const set2Games = [
        'FC 26',
        'Wwe 2k26',
        'Mortal Kombat',
        'Tekken8',
        'GTA 5'
    ];
    // Big Screen (65") associations
    const set1Id = seededSetups['Big Screen (65")'];
    if (set1Id) {
        for (const gameName of set1Games) {
            const gameId = seededGames[gameName];
            if (gameId) {
                // Insert if not already exists
                try {
                    await db
                        .insert(setupGamesTable)
                        .values({
                        setupId: set1Id,
                        gameId: gameId
                    });
                    console.log(`Mapped game "${gameName}" to Setup Big Screen (65")`);
                }
                catch (error) {
                    // Already mapped or duplicate error, ignore
                }
            }
        }
    }
    // Standard Screen (55") associations
    const set2Id = seededSetups['Standard Screen (55")'];
    if (set2Id) {
        for (const gameName of set2Games) {
            const gameId = seededGames[gameName];
            if (gameId) {
                try {
                    await db
                        .insert(setupGamesTable)
                        .values({
                        setupId: set2Id,
                        gameId: gameId
                    });
                    console.log(`Mapped game "${gameName}" to Setup Standard Screen (55")`);
                }
                catch (error) {
                    // Already mapped, ignore
                }
            }
        }
    }
    // 4. Seed Opening Offer
    console.log('Seeding opening offer...');
    const offerName = 'Opening Offer: Buy 1 Get 1 Free (1 person free on 1 person)';
    const existingOffer = await db
        .select()
        .from(offerTable)
        .where(eq(offerTable.name, offerName));
    let offerId;
    if (existingOffer.length > 0) {
        console.log(`Offer "${offerName}" already exists.`);
        offerId = existingOffer[0].id;
    }
    else {
        const [insertedOffer] = await db
            .insert(offerTable)
            .values({
            name: offerName,
            isActive: true,
            offerType: 'EXCLUSIVE'
        })
            .returning({ id: offerTable.id });
        console.log(`Inserted offer "${offerName}" with ID: ${insertedOffer.id}`);
        offerId = insertedOffer.id;
        // Add Offer details
        await db
            .insert(offerDetailsTable)
            .values({
            offerId: offerId,
            condObj: 'person',
            cond: '>=',
            condValue: '2',
            offerObj: 'person',
            offerValue: '1' // 1 person free
        });
        console.log(`Added offer details for Buy 1 Get 1 Free to Offer ID: ${offerId}`);
    }
    // 4b. Seed Flat 50 Off Offer
    console.log('Seeding Flat 50 Off offer...');
    const flatOfferName = 'Flat 50 Off: Save 50 on bookings >= 500';
    const existingFlatOffer = await db
        .select()
        .from(offerTable)
        .where(eq(offerTable.name, flatOfferName));
    if (existingFlatOffer.length > 0) {
        console.log(`Offer "${flatOfferName}" already exists.`);
    }
    else {
        const [insertedFlatOffer] = await db
            .insert(offerTable)
            .values({
            name: flatOfferName,
            isActive: true,
            offerType: 'INCLUSIVE' // Inclusive so it can apply with other offers
        })
            .returning({ id: offerTable.id });
        console.log(`Inserted offer "${flatOfferName}" with ID: ${insertedFlatOffer.id}`);
        // Add Offer details
        await db
            .insert(offerDetailsTable)
            .values({
            offerId: insertedFlatOffer.id,
            condObj: 'amount',
            cond: '>=',
            condValue: '500',
            offerObj: 'amount',
            offerValue: '50' // flat 50 rupees off
        });
        console.log(`Added offer details for Flat 50 Off to Offer ID: ${insertedFlatOffer.id}`);
    }
    // 5. Seed Users
    console.log('Seeding default users...');
    const usersList = [
        { email: 'superadmin@cafe.com', password: 'supersecret', role: 'SUPER_ADMIN' },
        { email: 'admin@cafe.com', password: 'adminsecret', role: 'ADMIN' },
        { email: 'member@cafe.com', password: 'membersecret', role: 'MEMBER' }
    ];
    for (const u of usersList) {
        const existing = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.email, u.email));
        if (existing.length > 0) {
            console.log(`User "${u.email}" already exists.`);
        }
        else {
            const passwordHash = hashPassword(u.password);
            await db
                .insert(usersTable)
                .values({
                email: u.email,
                passwordHash,
                role: u.role
            });
            console.log(`Inserted user "${u.email}" with role "${u.role}"`);
        }
    }
    console.log('Database seeding completed successfully!');
}
seed().catch((err) => {
    console.error('Error seeding database:', err);
    process.exit(1);
});
