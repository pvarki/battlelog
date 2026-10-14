import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { Player } from "../../media/Player.tsx";
import { Placeholder } from "../../Placeholder.tsx";
import { resolveType, type StreamsConfig } from "./widget.ts";

const StreamsView = ({ config, onConfigure }: WidgetViewProps<StreamsConfig>) => {
  const url = config.url.trim();
  if (!url) {
    return (
      <Placeholder
        title="No stream set"
        detail="Point this widget at a MediaMTX stream or an external video URL."
        action={{ label: "Set stream URL", onClick: onConfigure }}
      />
    );
  }
  const type = resolveType(config);
  // key: a new URL or player type tears the old player down completely.
  return <Player key={`${type}:${url}`} url={url} type={type} />;
};

export default StreamsView;
