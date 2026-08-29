import "varlock/auto-load";
import type { RouteHandler } from "@hono/zod-openapi";
import { ENV } from "varlock/env";
import { getManifestDeployment, getManifestProductDns } from "../../lib/kraftwerk.ts";
import { logger } from "../../lib/logger.ts";
import {
  createIngestSource,
  deleteIngestSource,
  IngestSourceNotFoundError,
  invalidateIngestSourceCache,
  listIngestSources,
  updateIngestSource,
} from "../../services/ingest/ingest.service.ts";
import { MatrixClient } from "../../services/matrix/matrix.client.ts";
import { availableMissions } from "../../services/tak/tak.mission.ts";
import { toApiIngestSource, toApiIngestSourceName, transportStatuses } from "./ingest.apiSchema.ts";
import type {
  createMatrixRoomRoute,
  deleteIngestSourceRoute,
  listIngestSourceNamesRoute,
  listIngestSourcesRoute,
  listMatrixRoomsRoute,
  listTakMissionsRoute,
  patchIngestSourceRoute,
  postIngestSourceRoute,
  transportStatusRoute,
} from "./ingest.routes.ts";

export const listIngestSourcesHandler: RouteHandler<typeof listIngestSourcesRoute> = async (c) => {
  const rows = await listIngestSources();
  return c.json(rows.map(toApiIngestSource), 200);
};

/** Names only, for anyone choosing which setups a dashboard feed shows. */
export const listIngestSourceNamesHandler: RouteHandler<typeof listIngestSourceNamesRoute> = async (
  c,
) => {
  const rows = await listIngestSources();
  return c.json(rows.map(toApiIngestSourceName), 200);
};

export const postIngestSourceHandler: RouteHandler<typeof postIngestSourceRoute> = async (c) => {
  const user = c.get("userCn") ?? "anonymous";
  const body = c.req.valid("json");
  const row = await createIngestSource({ ...body, createdBy: user });
  // So the ingesters see it on their next cycle rather than up to a TTL later.
  invalidateIngestSourceCache();
  logger.info({ kind: row.kind, name: row.name, by: user }, "ingest source created");
  return c.json(toApiIngestSource(row), 201);
};

export const patchIngestSourceHandler: RouteHandler<typeof patchIngestSourceRoute> = async (c) => {
  const { sourceId } = c.req.valid("param");
  const user = c.get("userCn") ?? "anonymous";
  try {
    const row = await updateIngestSource(sourceId, c.req.valid("json"), user);
    invalidateIngestSourceCache();
    logger.info({ id: row.id, enabled: row.enabled, by: user }, "ingest source updated");
    return c.json(toApiIngestSource(row), 200);
  } catch (err) {
    if (err instanceof IngestSourceNotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
};

export const deleteIngestSourceHandler: RouteHandler<typeof deleteIngestSourceRoute> = async (
  c,
) => {
  const { sourceId } = c.req.valid("param");
  try {
    await deleteIngestSource(sourceId);
    invalidateIngestSourceCache();
    logger.info({ id: sourceId, by: c.get("userCn") }, "ingest source deleted");
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof IngestSourceNotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
};

export const transportStatusHandler: RouteHandler<typeof transportStatusRoute> = async (c) =>
  c.json(transportStatuses(), 200);

/**
 * The deployment's Space, resolved from our own kraftwerk manifest.
 *
 * matrixrmapi builds the alias from the same deployment name and domain we
 * already have, so it does not have to expose room ids to us.
 */
const spaceIdFor = async (
  client: MatrixClient,
): Promise<{ spaceId: string } | { error: string }> => {
  const deployment = getManifestDeployment();
  const domain = (getManifestProductDns() ?? "").split(".").slice(1).join(".");
  if (!deployment || !domain) {
    return { error: "Deployment name or domain missing from the manifest" };
  }
  const spaceId = await client.roomIdForAlias(`#${deployment}-space:${domain}`);
  if (!spaceId) return { error: "Deployment Space not found on the homeserver" };
  return { spaceId };
};

/**
 * Create a room the ingester can read, inside the Space.
 *
 * This exists because there is otherwise no way to get one: a client creating a
 * room turns on encryption by default and Matrix cannot undo it, so every room
 * made the ordinary way is permanently unreadable to a consumer without megolm
 * support. Rather than document that trap, we offer the room.
 */
export const createMatrixRoomHandler: RouteHandler<typeof createMatrixRoomRoute> = async (c) => {
  const baseUrl = ENV.MATRIX_HOMESERVER_URL;
  if (!baseUrl) return c.json({ error: "Matrix ingest is not configured" }, 503);
  const client = new MatrixClient(baseUrl);
  try {
    await client.setup();
    const space = await spaceIdFor(client);
    if ("error" in space) return c.json({ error: space.error }, 503);
    const roomId = await client.createIngestRoom(c.req.valid("json").name, space.spaceId);
    logger.info({ roomId, by: c.get("userCn") }, "created an ingestible Matrix room");
    return c.json({ roomId }, 201);
  } catch (err) {
    logger.error({ err }, "could not create a Matrix room");
    return c.json({ error: "Could not create the room" }, 503);
  }
};

/**
 * Rooms in the deployment's Matrix Space, so the settings page can offer a list
 * instead of asking someone to type a room ID.
 *
 * The Space is found from our own kraftwerk manifest — matrixrmapi builds its
 * alias from the same deployment name and domain we already have, so it does not
 * have to expose room IDs to us.
 */
export const listMatrixRoomsHandler: RouteHandler<typeof listMatrixRoomsRoute> = async (c) => {
  const baseUrl = ENV.MATRIX_HOMESERVER_URL;
  if (!baseUrl) return c.json({ error: "Matrix ingest is not configured" }, 503);
  const deployment = getManifestDeployment();
  const domain = (getManifestProductDns() ?? "").split(".").slice(1).join(".");
  if (!deployment || !domain) {
    return c.json({ error: "Deployment name or domain missing from the manifest" }, 503);
  }
  const client = new MatrixClient(baseUrl);
  try {
    await client.setup();
    const space = await spaceIdFor(client);
    if ("error" in space) return c.json({ error: space.error }, 503);
    const rooms = await client.spaceRooms(space.spaceId);
    return c.json(
      rooms.filter((room) => !room.isSpace),
      200,
    );
  } catch (err) {
    logger.error({ err }, "could not list Matrix rooms");
    return c.json({ error: "Could not reach the homeserver" }, 503);
  }
};

export const listTakMissionsHandler: RouteHandler<typeof listTakMissionsRoute> = async (c) => {
  if (!ENV.TAK_STREAM_HOST) return c.json({ error: "TAK ingest is not configured" }, 503);
  try {
    return c.json(await availableMissions(), 200);
  } catch (err) {
    logger.error({ err }, "could not list TAK Data Sync feeds");
    // The message names the fix when TAK refused us, so pass it through rather
    // than flattening every failure to "could not reach".
    return c.json({ error: err instanceof Error ? err.message : "Could not reach TAK" }, 503);
  }
};
