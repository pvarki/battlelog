import { ActionIcon, Menu } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconPhoto, IconPrinter } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { CoordFormat } from "../coords.ts";
import { download } from "../download.ts";
import { mapImageBlob, printImage } from "./map-image.ts";

const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

const imageFailed = (err: unknown) =>
  notifications.show({
    color: "red",
    title: "Couldn't make the map image",
    message: err instanceof Error ? err.message : String(err),
  });

/** The map on screen as a picture: saved as a file or printed. */
export const MapImageButton = ({
  map,
  coordFormat,
}: {
  map: MapLibreMap;
  coordFormat: CoordFormat;
}) => (
  <Menu position="left-start" withinPortal>
    <Menu.Target>
      <ActionIcon variant="default" size="md" aria-label="Map image" title="Save or print the map">
        <IconCamera size={18} />
      </ActionIcon>
    </Menu.Target>
    <Menu.Dropdown>
      <Menu.Item
        leftSection={<IconPhoto size={14} />}
        onClick={() =>
          void mapImageBlob(map, coordFormat).then(
            (blob) => download(blob, `battlelog-map-${fileStamp()}.png`),
            imageFailed,
          )
        }
      >
        Save as image
      </Menu.Item>
      <Menu.Item
        leftSection={<IconPrinter size={14} />}
        onClick={() => void mapImageBlob(map, coordFormat).then(printImage, imageFailed)}
      >
        Print
      </Menu.Item>
    </Menu.Dropdown>
  </Menu>
);
