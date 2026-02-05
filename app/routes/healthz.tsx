import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { prisma } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const health: {
    status: "ok" | "error";
    timestamp: string;
    database: { status: "ok" | "error"; message?: string };
    redis: { status: "ok" | "error" | "not_configured"; message?: string };
  } = {
    status: "ok",
    timestamp: new Date().toISOString(),
    database: { status: "ok" },
    redis: { status: "not_configured", message: "Redis check requires queue.server.ts" },
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

  // Redis check will be added when queue.server.ts is implemented in Phase 2

  const statusCode = health.status === "ok" ? 200 : 503;
  return json(health, { status: statusCode });
};
