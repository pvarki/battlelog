import { ActionIcon, Box, Button, CopyButton, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { useState } from "react";
import { Player } from "../../widgets/streams/View.tsx";
import { detectSourceType, isBrowserPlayable } from "../../widgets/streams/widget.ts";
import type { TakItem } from "../cot.ts";

/** The URL as shown on screen; copying still gives the real one. */
export const maskCredentials = (url: string) =>
  url
    .replace(/\/\/([^/@:]+):[^/@]+@/, "//$1:•••@")
    .replace(/([?&](?:pass|password|pwd|token)=)[^&]*/gi, "$1•••");

/** An item's video feed: played in place when a browser can, otherwise its URL to open elsewhere. */
export const VideoFeed = ({ video }: { video: NonNullable<TakItem["video"]> }) => {
  const [watching, setWatching] = useState(false);
  const playable = isBrowserPlayable(video.url);

  return (
    <Stack gap={6}>
      {watching && (
        <Box style={{ aspectRatio: "16 / 9" }}>
          <Player key={video.url} url={video.url} type={detectSourceType(video.url)} />
        </Box>
      )}
      {playable ? (
        <Button
          variant="light"
          size="xs"
          leftSection={watching ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
          onClick={() => setWatching(!watching)}
        >
          {watching ? "Stop video" : "Watch video"}
        </Button>
      ) : (
        <Text fz="xs" c="dimmed">
          This stream can't play in a browser. Open it in a video player such as VLC.
        </Text>
      )}
      <Group gap={4} wrap="nowrap" align="flex-start">
        <Text fz="xs" className="tak-mono" style={{ overflowWrap: "anywhere" }}>
          {maskCredentials(video.url)}
        </Text>
        <CopyButton value={video.url}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Copied" : "Copy video URL"} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={copy}
                aria-label="Copy video URL"
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
    </Stack>
  );
};
