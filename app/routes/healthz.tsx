import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (_request: LoaderFunctionArgs) => {
  // Simple healthcheck - just return OK for Railway
  // Database and Redis checks can cause startup failures
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
};
