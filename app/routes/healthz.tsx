import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { prisma } from "../db.server";
import { isRedisHealthy } from "../queue.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const health: {
    status: "ok" | "error";
    timestamp: string;
    version: string;
    database: { status: "ok" | "error"; message?: string };
    redis: { status: "ok" | "error"; message?: string };
  } = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    database: { status: "ok" },
    redis: { status: "ok" },
  };

  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    health.database = {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown database error",
    };
    health.status = "error";
  }

  // Check Redis connectivity
  try {
    const redisHealthy = await isRedisHealthy();
    if (!redisHealthy) {
      health.redis = {
        status: "error",
        message: "Redis ping failed",
      };
      health.status = "error";
    }
  } catch (error) {
    health.redis = {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown Redis error",
    };
    health.status = "error";
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  return json(health, { status: statusCode });
};
