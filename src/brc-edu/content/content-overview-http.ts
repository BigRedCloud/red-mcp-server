import { buildContentOverview } from "./content-overview-service.js";

export async function handleContentOverview(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  try {
    const payload = await buildContentOverview();
    return { status: 200, body: payload };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not build content overview.";
    return {
      status: 503,
      body: { error: message },
    };
  }
}
