/**
 * Quick test to verify Redis connection
 */
import "dotenv/config";
import Redis from "ioredis";

async function testRedis() {
  console.log("Testing Redis connection...\n");

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("❌ REDIS_URL not set in .env");
    process.exit(1);
  }

  console.log(`Connecting to: ${redisUrl.replace(/:[^:@]+@/, ":***@")}`);

  const redis = new Redis(redisUrl);

  try {
    const pong = await redis.ping();
    console.log(`✅ Redis connected! PING response: ${pong}`);

    // Quick set/get test
    await redis.set("test-key", "hello-delayguard");
    const value = await redis.get("test-key");
    console.log(`✅ Set/Get test passed: ${value}`);
    await redis.del("test-key");

    await redis.quit();
    console.log("\n✅ Redis is working!");
  } catch (error) {
    console.error("❌ Redis connection failed:", error);
    process.exit(1);
  }
}

testRedis();
