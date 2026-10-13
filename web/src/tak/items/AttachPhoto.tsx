import { Button, FileButton, Group, Image, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPhoto } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { attachPhotoLink } from "../commands.ts";
import type { TakItem } from "../cot.ts";
import { labelOf } from "../items.ts";

type Props = { item: TakItem; callsign: string; disabled: boolean };

/** Picks a photo, previews it, and on confirm uploads it to TAK and links it from the item. */
export const AttachPhoto = ({ item, callsign, disabled }: Props) => {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const attach = () => {
    if (!photo) return;
    attachPhotoLink(item, photo, callsign).catch((err) =>
      notifications.show({ color: "red", title: "Photo not attached", message: String(err) }),
    );
    setPhoto(null);
  };

  return (
    <>
      <FileButton onChange={setPhoto} accept="image/*">
        {(props) => (
          <Button
            {...props}
            variant="default"
            size="xs"
            leftSection={<IconPhoto size={14} />}
            disabled={disabled}
          >
            Attach photo
          </Button>
        )}
      </FileButton>
      <Modal
        opened={!!photo}
        onClose={() => setPhoto(null)}
        title={`Attach photo to ${labelOf(item)}`}
        centered
      >
        <Stack gap="sm">
          {preview && (
            <Image src={preview} alt="Photo to attach" radius="sm" mah={320} fit="contain" />
          )}
          <Text fz="sm" c="dimmed">
            The photo is uploaded to TAK and linked in the item's remarks, so every TAK user can
            open it.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setPhoto(null)}>
              Cancel
            </Button>
            <Button size="xs" onClick={attach} data-autofocus>
              Attach
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
