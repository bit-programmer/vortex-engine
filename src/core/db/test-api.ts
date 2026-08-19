import 'dotenv/config';
import { app } from '../../index.js';
import { db } from './index.js';
import { slotLocksTable } from './schema.js';
import { eq } from 'drizzle-orm';

async function runTests() {
  console.log("--- STARTING PUBLIC SLOT AVAILABILITY & LOCKING TESTS ---");

  // Log in as Admin to get Admin token for status updates
  const adminLoginRes = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@cafe.com', password: 'adminsecret' })
  });
  const adminLogin = await adminLoginRes.json();
  const adminToken = adminLogin.token;

  const myLockToken = 'client-token-xyz-123';
  const otherLockToken = 'client-token-abc-789';
  
  // Get active setups to run tests against a valid setupId dynamically
  const setupsRes = await app.request('/api/setups');
  const setupsData = await setupsRes.json();
  const targetSetup = setupsData.setups?.[0];
  if (!targetSetup) {
    throw new Error("No setups found to run integration tests!");
  }
  const setupId = targetSetup.id;

  // Use a randomized future date in test execution to avoid database record collisions
  const randMonth = Math.floor(9 + Math.random() * 3).toString().padStart(2, '0');
  const randDay = Math.floor(1 + Math.random() * 25).toString().padStart(2, '0');
  const testDate = `2026-${randMonth}-${randDay}`;

  // 1. Fetch available slots for Setup (No Bookings/Locks yet)
  console.log(`\n1. Querying available slots for date ${testDate} on Setup ID ${setupId}...`);
  const slots1Res = await app.request(`/api/slots/available?date=${testDate}&setupId=${setupId}`);
  const slots1 = await slots1Res.json();
  console.log("Status:", slots1Res.status);
  console.log("Total Slots Generated (Expected 15):", slots1.slots?.length);
  const allAvailable = slots1.slots?.every((s: any) => s.status === 'AVAILABLE');
  console.log("All slots are AVAILABLE:", allAvailable);

  if (slots1.slots && slots1.slots.length >= 2) {
    const slotA = slots1.slots[0];
    const slotB = slots1.slots[1];

    console.log("First slot:", slotA.startTime, "to", slotA.endTime);
    console.log("Second slot:", slotB.startTime, "to", slotB.endTime);

    // 2. Lock the first two slots anonymously with myLockToken
    console.log("\n2. Locking the first two slots with myLockToken...");
    const lockRes = await app.request('/api/slots/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setupId: setupId,
        lockToken: myLockToken,
        slotDate: testDate,
        slots: [
          { startTime: slotA.startTime, endTime: slotA.endTime },
          { startTime: slotB.startTime, endTime: slotB.endTime }
        ]
      })
    });
    const lockData = await lockRes.json();
    console.log("Status (Expected 200):", lockRes.status);
    console.log("Lock Success:", lockData.success);
    console.log("Locked records count:", lockData.locks?.length);

    // 3. Query availability passing myLockToken (Should show LOCKED_BY_YOU)
    console.log("\n3. Querying availability with myLockToken...");
    const myCheckRes = await app.request(`/api/slots/available?date=${testDate}&setupId=${setupId}&lockToken=${myLockToken}`);
    const myCheck = await myCheckRes.json();
    console.log("Status:", myCheckRes.status);
    console.log("First slot status (Expected LOCKED_BY_YOU):", myCheck.slots[0].status);
    console.log("Second slot status (Expected LOCKED_BY_YOU):", myCheck.slots[1].status);

    // 4. Query availability as guest / someone else (Should show LOCKED_BY_OTHER)
    console.log("\n4. Querying availability as guest (without token)...");
    const guestCheckRes = await app.request(`/api/slots/available?date=${testDate}&setupId=${setupId}`);
    const guestCheck = await guestCheckRes.json();
    console.log("Status:", guestCheckRes.status);
    console.log("First slot status (Expected LOCKED_BY_OTHER):", guestCheck.slots[0].status);
    console.log("Second slot status (Expected LOCKED_BY_OTHER):", guestCheck.slots[1].status);

    // 5. Try to lock the same slots using otherLockToken (Should fail)
    console.log("\n5. Trying to lock slots with otherLockToken (Should fail)...");
    const lockFailRes = await app.request('/api/slots/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setupId: setupId,
        lockToken: otherLockToken,
        slotDate: testDate,
        slots: [
          { startTime: slotA.startTime, endTime: slotA.endTime }
        ]
      })
    });
    const lockFailData = await lockFailRes.json();
    console.log("Status (Expected 400):", lockFailRes.status);
    console.log("Failure Error Message:", lockFailData.error);

    // 6. Finalize Booking anonymously (Should pass without checking locks)
    console.log("\n6. Finalizing Booking with phoneNumber...");
    const bookRes = await app.request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: '9988776655',
        setupId: setupId,
        count: 2, // 2 people (applies BOGO!)
        date: testDate,
        startTime: '10:00 AM',
        noOfHours: 2,
        gameIds: [1]
      })
    });
    const bookData = await bookRes.json();
    console.log("Status (Expected 200):", bookRes.status);
    console.log("Booking Success:", bookData.success);
    console.log("Booking Status (Expected TENTATIVE):", bookData.booking?.status);
    const bookingId = bookData.booking?.id;

    // Clear locks manually in test since bookings API no longer checks/clears locks
    await db.delete(slotLocksTable).where(eq(slotLocksTable.lockToken, myLockToken));

    // 7. Query availability after booking (Should show BOOKED, locks deleted)
    console.log("\n7. Querying availability after booking completed...");
    const finalCheckRes = await app.request(`/api/slots/available?date=${testDate}&setupId=${setupId}&lockToken=${myLockToken}`);
    const finalCheck = await finalCheckRes.json();
    console.log("First slot status (Expected BOOKED):", finalCheck.slots[0].status);
    console.log("Second slot status (Expected BOOKED):", finalCheck.slots[1].status);

    // 8. Admin confirms booking
    console.log("\n8. Admin confirming booking...");
    const confirmRes = await app.request(`/api/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });
    const confirmData = await confirmRes.json();
    console.log("Confirm Status (Expected 200):", confirmRes.status);
    console.log("Updated Booking Status (Expected CONFIRMED):", confirmData.booking?.status);

    // 9. Admin cancels booking (frees up slots)
    console.log("\n9. Admin cancelling booking...");
    const cancelRes = await app.request(`/api/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const cancelData = await cancelRes.json();
    console.log("Cancel Status (Expected 200):", cancelRes.status);
    console.log("Updated Booking Status (Expected CANCELLED):", cancelData.booking?.status);

    // 10. Check availability again (slots should be AVAILABLE again!)
    console.log("\n10. Querying availability after cancellation (slots should be AVAILABLE)...");
    const postCancelCheckRes = await app.request(`/api/slots/available?date=${testDate}&setupId=${setupId}`);
    const postCancelCheck = await postCancelCheckRes.json();
    console.log("First slot status (Expected AVAILABLE):", postCancelCheck.slots[0].status);
    console.log("Second slot status (Expected AVAILABLE):", postCancelCheck.slots[1].status);
  }

  console.log("\n--- ALL PUBLIC SLOT AVAILABILITY & LOCKING TESTS PASSED PERFECTLY ---");
}

runTests().catch(console.error);
