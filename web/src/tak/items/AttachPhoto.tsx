import {
  Button,
  Checkbox,
  FileButton,
  Group,
  Image,
  Modal,
  MultiSelect,
  Radio,
  Stack,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPhoto } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { attachPhotoLink } from "../commands.ts";
import type { TakItem } from "../cot.ts";
import { sendPhotoPackage } from "../datapackage.ts";
import { labelOf } from "../items.ts";

type Props = {
  item: TakItem;
  callsign: string;
  /** Callsigns of TAK users a photo can be sent to. */
  contacts: string[];
  disabled: boolean;
};

/**
 * Picks a photo and delivers it to TAK in one or both ways: as a link in the
 * item's remarks (every client shows it) and as an ATAK data package, which
 * lands in the marker's own attachments on ATAK.
 */
export const AttachPhoto = ({ item, callsign, contacts, disabled }: Props) => {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [link, setLink] = useState(true);
  const [toAtak, setToAtak] = useState(true);
  const [audience, setAudience] = useState<"everyone" | "chosen">("everyone");
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const recipients = audience === "everyone" ? [] : chosen;
  const nothingToDo =
    (!link && !toAtak) || (toAtak && audience === "chosen" && chosen.length === 0);

  const attach = async () => {
    if (!photo) return;
    setPhoto(null);
    const failed = (what: string) => (err: unknown) =>
      notifications.show({ color: "red", title: `Photo not ${what}`, message: String(err) });
    if (link) await attachPhotoLink(item, photo, callsign).catch(failed("linked"));
    if (toAtak) {
      await sendPhotoPackage(item, photo, callsign, recipients).then(
        () =>
          notifications.show({
            color: "teal",
            message: `Photo sent to ${recipients.length ? recipients.join(", ") : "every TAK user"}`,
          }),
        failed("sent to ATAK users"),
      );
    }
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
            <Image src={preview} alt="Photo to attach" radius="sm" mah={280} fit="contain" />
          )}
          <Checkbox
            size="xs"
            label="Link it in the remarks"
            description="Every TAK client shows the link; BattleLog shows the photo."
            checked={link}
            onChange={(e) => setLink(e.currentTarget.checked)}
          />
          <Checkbox
            size="xs"
            label="Send it to ATAK users"
            description="Arrives in the marker's attachments, as when sent from ATAK."
            checked={toAtak}
            onChange={(e) => setToAtak(e.currentTarget.checked)}
          />
          {toAtak && (
            <Stack gap="xs" pl="lg">
              <Radio.Group value={audience} onChange={(v) => setAudience(v as typeof audience)}>
                <Group gap="md">
                  <Radio size="xs" value="everyone" label="Everyone" />
                  <Radio size="xs" value="chosen" label="Chosen users" />
                </Group>
              </Radio.Group>
              {audience === "chosen" && (
                <MultiSelect
                  size="xs"
                  placeholder="Callsigns"
                  aria-label="Send to"
                  data={contacts}
                  value={chosen}
                  onChange={setChosen}
                  searchable
                  comboboxProps={{ withinPortal: true }}
                />
              )}
            </Stack>
          )}
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setPhoto(null)}>
              Cancel
            </Button>
            <Button size="xs" onClick={() => void attach()} disabled={nothingToDo} data-autofocus>
              Attach
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
