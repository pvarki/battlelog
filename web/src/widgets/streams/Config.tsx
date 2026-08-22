import { Select, Stack, TextInput } from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { resolveType, type StreamsConfig } from "./widget.ts";

const SOURCE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "whep", label: "WebRTC (WHEP)" },
  { value: "hls", label: "HLS (.m3u8)" },
  { value: "mjpeg", label: "MJPEG" },
  { value: "video", label: "Direct video (MP4/WebM)" },
];

const StreamsConfigForm = ({ config, onChange }: WidgetConfigProps<StreamsConfig>) => (
  <Stack>
    <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
    <TextInput
      label="Stream URL"
      placeholder="http://mediamtx:8889/cam1/whep"
      description="MediaMTX WHEP (:8889/<path>/whep) or HLS (:8888/<path>/index.m3u8), an external HLS link, an MJPEG camera, or a direct video file"
      value={config.url}
      onChange={(e) => onChange({ ...config, url: e.currentTarget.value })}
    />
    <Select
      label="Source type"
      description={
        config.sourceType === "auto" && config.url.trim()
          ? `Detected: ${resolveType(config)}`
          : undefined
      }
      data={SOURCE_OPTIONS}
      value={config.sourceType}
      onChange={(v) => v && onChange({ ...config, sourceType: v as StreamsConfig["sourceType"] })}
    />
  </Stack>
);

export default StreamsConfigForm;
