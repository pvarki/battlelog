import { Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { fetchMissionLayers, type Mission, type MissionLayer } from "./missions.ts";
import { Section } from "./shared.tsx";

/** The feed's layers and map layers as TAK has them; read-only, shown only when there are any. */
export const MissionLayers = ({ mission }: { mission: Mission }) => {
  const [layers, setLayers] = useState<MissionLayer[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    setLayers([]);
    fetchMissionLayers(mission.name, abort.signal).then(setLayers, (err: unknown) => {
      if (!abort.signal.aborted) console.warn(`TAK layers of ${mission.name} unavailable`, err);
    });
    return () => abort.abort();
  }, [mission.name]);
  if (layers.length === 0 && mission.mapLayers.length === 0) return null;
  return (
    <Section title="Map layers">
      {layers.map((layer) => (
        <Text key={layer.uid} fz="sm" pl={layer.depth * 12} truncate>
          {layer.name}
          {layer.type && (
            <Text span fz="xs" c="dimmed">
              {` · ${layer.type.toLowerCase()}`}
            </Text>
          )}
        </Text>
      ))}
      {mission.mapLayers.map((layer) => (
        <div key={`${layer.name}:${layer.url}`} className="tak-row">
          <Text fz="sm" truncate>
            {layer.name}
          </Text>
          {(layer.type || layer.url) && (
            <Text fz="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
              {[layer.type, layer.url].filter(Boolean).join(" · ")}
            </Text>
          )}
        </div>
      ))}
    </Section>
  );
};
