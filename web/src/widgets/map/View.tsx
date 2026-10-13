import { Button } from "@mantine/core";
import { IconPin } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { viewOf } from "../../tak/map/MapCanvas.tsx";
import { hiddenExcept } from "../../tak/overlays.ts";
import { TakWorkspace } from "../../tak/TakWorkspace.tsx";
import type { MapConfig } from "./widget.ts";

const MapWidgetView = ({ config, editMode, updateConfig }: WidgetViewProps<MapConfig>) => {
  const [map, setMap] = useState<MapLibreMap>();
  return (
    <div className="tak-widget">
      <TakWorkspace
        tools={new Set(config.tools)}
        view={config.view}
        embedded
        onMap={setMap}
        display={config.display}
        hiddenGroups={config.groups?.length ? hiddenExcept(config.groups) : undefined}
        missions={config.missions}
        follow={config.follow}
      />
      {editMode && map && (
        <Button
          className="tak-widget-pin"
          size="xs"
          leftSection={<IconPin size={14} />}
          onClick={() => updateConfig({ ...config, view: viewOf(map) })}
        >
          Open here
        </Button>
      )}
    </div>
  );
};

export default MapWidgetView;
