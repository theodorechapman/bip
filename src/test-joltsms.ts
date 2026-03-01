/**
 * Quick test script for JoltSMS integration.
 * Run: bun src/test-joltsms.ts
 *
 * Tests:
 *   1. List existing numbers
 *   2. Get number details
 *   3. List recent messages
 *   4. (Optional) Wait for an OTP in real-time
 *
 * Requires JOLTSMS_API_KEY in .env
 */

import {
  listNumbers,
  getNumber,
  listMessages,
  getLatestOtp,
  waitForOtp,
} from "./joltsms-client";

async function main() {
  const cmd = process.argv[2] ?? "status";

  switch (cmd) {
    case "status": {
      console.log("Listing active numbers...\n");
      const numbers = await listNumbers();
      if (numbers.length === 0) {
        console.log("No active numbers. Rent one from the JoltSMS dashboard first.");
        return;
      }
      for (const n of numbers) {
        console.log(`  ${n.phoneNumber}  (id: ${n.id}, status: ${n.status})`);
      }
      console.log(`\nTotal: ${numbers.length} number(s)`);
      break;
    }

    case "messages": {
      const numberId = process.argv[3];
      if (!numberId) {
        console.error("Usage: bun src/test-joltsms.ts messages <numberId>");
        process.exit(1);
      }
      console.log(`Fetching messages for ${numberId}...\n`);
      const msgs = await listMessages(numberId);
      if (msgs.length === 0) {
        console.log("No messages yet.");
        return;
      }
      for (const m of msgs) {
        console.log(`  From: ${m.from}`);
        console.log(`  Body: ${m.body}`);
        console.log(`  OTP:  ${m.parsedCode ?? "(none)"}`);
        console.log(`  Time: ${m.receivedAt}`);
        console.log("");
      }
      break;
    }

    case "wait": {
      const numberId = process.argv[3];
      if (!numberId) {
        console.error("Usage: bun src/test-joltsms.ts wait <numberId> [timeout]");
        process.exit(1);
      }
      const timeout = parseInt(process.argv[4] ?? "120", 10);
      console.log(`Waiting for OTP on ${numberId} (timeout: ${timeout}s)...\n`);
      const result = await waitForOtp(numberId, timeout, 5);
      if (result) {
        console.log(`\nOTP: ${result.code}`);
        console.log(`From: ${result.message.from}`);
        console.log(`Body: ${result.message.body}`);
      } else {
        console.log("\nNo OTP received within timeout.");
      }
      break;
    }

    case "latest-otp": {
      const numberId = process.argv[3];
      if (!numberId) {
        console.error("Usage: bun src/test-joltsms.ts latest-otp <numberId>");
        process.exit(1);
      }
      const code = await getLatestOtp(numberId);
      console.log(code ? `Latest OTP: ${code}` : "No OTP found.");
      break;
    }

    default:
      console.log("Usage: bun src/test-joltsms.ts <status|messages|wait|latest-otp> [args]");
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
