/**
 * Test script to verify UPS API credentials work
 *
 * Usage: npx tsx scripts/test-ups.ts [tracking_number]
 *
 * If no tracking number provided, it will just test OAuth token retrieval.
 */

import "dotenv/config";

const UPS_TOKEN_URL = "https://onlinetools.ups.com/security/v1/oauth/token";
const UPS_TRACK_URL = "https://onlinetools.ups.com/api/track/v1/details";

async function testUpsConnection() {
  console.log("=== UPS API Connection Test ===\n");

  // Check credentials
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("❌ Missing UPS credentials in .env file");
    console.error("   Required: UPS_CLIENT_ID and UPS_CLIENT_SECRET");
    process.exit(1);
  }

  console.log("✓ UPS credentials found in .env");
  console.log(`  Client ID: ${clientId.substring(0, 8)}...${clientId.substring(clientId.length - 4)}`);

  // Test OAuth token
  console.log("\n--- Testing OAuth Token ---");

  try {
    const tokenResponse = await fetch(UPS_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`❌ OAuth token request failed: ${tokenResponse.status}`);
      console.error(`   Response: ${errorText}`);
      process.exit(1);
    }

    const tokenData = await tokenResponse.json() as { access_token: string; expires_in: number; token_type: string };
    console.log("✓ OAuth token obtained successfully!");
    console.log(`  Token type: ${tokenData.token_type}`);
    console.log(`  Expires in: ${tokenData.expires_in} seconds`);
    console.log(`  Token: ${tokenData.access_token.substring(0, 20)}...`);

    // Test tracking if a number was provided
    const trackingNumber = process.argv[2];

    if (trackingNumber) {
      console.log(`\n--- Testing Track API with: ${trackingNumber} ---`);

      const trackResponse = await fetch(`${UPS_TRACK_URL}/${encodeURIComponent(trackingNumber)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
          transId: `test-${Date.now()}`,
          transactionSrc: "DelayGuard-Test",
        },
      });

      console.log(`  Response status: ${trackResponse.status}`);

      const trackData = await trackResponse.json();

      if (trackResponse.ok) {
        console.log("✓ Track API call successful!");

        const shipment = (trackData as any).trackResponse?.shipment?.[0];
        const pkg = shipment?.package?.[0];

        if (pkg) {
          const status = pkg.currentStatus?.status || pkg.activity?.[0]?.status;
          console.log(`\n  Package Status:`);
          console.log(`    Status: ${status?.description || "Unknown"}`);
          console.log(`    Type: ${status?.type || "Unknown"}`);

          if (pkg.deliveryDate?.[0]) {
            console.log(`    Expected Delivery: ${pkg.deliveryDate[0].date}`);
          }

          if (pkg.activity?.[0]) {
            const lastActivity = pkg.activity[0];
            console.log(`\n  Last Activity:`);
            console.log(`    ${lastActivity.status?.description}`);
            console.log(`    ${lastActivity.date} ${lastActivity.time}`);
            if (lastActivity.location?.address) {
              const addr = lastActivity.location.address;
              console.log(`    ${addr.city}, ${addr.stateProvince} ${addr.country}`);
            }
          }
        }
      } else {
        console.log("❌ Track API call failed");
        console.log(`  Response: ${JSON.stringify(trackData, null, 2)}`);
      }
    } else {
      console.log("\n💡 To test tracking, run with a tracking number:");
      console.log("   npx tsx scripts/test-ups.ts 1Z999AA10123456784");
    }

    console.log("\n=== Test Complete ===");

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

testUpsConnection();
