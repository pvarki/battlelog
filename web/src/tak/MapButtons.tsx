import { ActionIcon, Alert } from "@mantine/core";
import { IconCurrentLocation, IconHistory, IconPlugConnectedX } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { createPortal } from "react-dom";
import type { CoordFormat } from "./coords.ts";
import { MapImageButton } from "./map/MapImageButton.tsx";
import type { TakStatus } from "./session.ts";

/** Locate, Replay and the map image, in MapLibre's own control stack under zoom and compass. */
export const MapButtons = ({
  map,
  locating,
  onLocate,
  replaying,
  onReplay,
  coordFormat,
}: {
  map: MapLibreMap | undefined;
  locating: boolean;
  onLocate: () => void;
  replaying: boolean;
  onReplay: () => void;
  coordFormat: CoordFormat;
}) => {
  const controls = map?.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-top-right");
  if (!map || !controls) return null;
  return createPortal(
    <div className="maplibregl-ctrl tak-map-buttons">
      <ActionIcon
        className="tak-locate"
        variant="default"
        size="md"
        aria-label="Locate me"
        title="Locate me (shown only to you)"
        aria-pressed={locating}
        onClick={onLocate}
      >
        <IconCurrentLocation size={18} />
      </ActionIcon>
      <ActionIcon
        className="tak-replay"
        variant="default"
        size="md"
        aria-label="Replay history"
        title="Replay history"
        aria-pressed={replaying}
        onClick={onReplay}
      >
        <IconHistory size={18} />
      </ActionIcon>
      <MapImageButton map={map} coordFormat={coordFormat} />
    </div>,
    controls,
  );
};

export const ConnectionBanner = ({ status }: { status: TakStatus }) => {
  if (status.connection !== "down") return null;
  return (
    // Amber and outlined: filled red is kept for emergencies, which must stand out above this.
    <Alert color="warning" variant="outline" icon={<IconPlugConnectedX size={18} />}>
      {status.everConnected
        ? "Connection to TAK lost — reconnecting. The map shows the last known picture."
        : "Can't connect to TAK. Open BattleLog from the deploy app so your device certificate is used. TAK may also be unreachable."}
    </Alert>
  );
};
