import { Button } from "@mantine/core";
import { IconPin } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { dashboardRoute } from "../../routes.tsx";
import { viewOf } from "../../tak/map/MapCanvas.tsx";
import { hiddenExcept } from "../../tak/overlays.ts";
import { TakMapView } from "../../tak/TakMapView.tsx";
import { effectiveMap, type MapConfig } from "./widget.ts";

const MapWidgetView = ({ config, editMode, updateConfig }: WidgetViewProps<MapConfig>) => {
  const [map, setMap] = useState<MapLibreMap>();
  const { event, tak } = dashboardRoute.useSearch();
  const navigate = dashboardRoute.useNavigate();
  const effective = effectiveMap(config);
  return (
    <div className="tak-widget">
      <TakMapView
        view={config.view}
        basemap={config.basemap}
        overlay={config.overlay}
        dim={config.dim}
        mgrsGrid={config.mgrsGrid}
        tracks={config.tracks}
        hiddenGroups={config.groups?.length ? hiddenExcept(config.groups) : undefined}
        missions={config.missions}
        eventLayers={config.eventLayers}
        follow={config.follow}
        symbolScale={effective.symbolScale}
        controls={effective.controls}
        panZoom={effective.panZoom}
        select={effective.select}
        cardActions={effective.cardActions}
        selection={{ event, tak }}
        // An event picked here keeps the TAK selection that widgets following it narrow to.
        onSelect={
          effective.shareSelection
            ? (next) =>
                navigate({
                  search: (prev) =>
                    next.event ? { ...prev, event: next.event } : { ...prev, ...next },
                  replace: true,
                })
            : undefined
        }
        centreOnSelection={effective.centreOnSelection}
        answerPicks={effective.answerPicks}
        onMap={setMap}
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
