import { Anchor, Group, Select, Stack, Text } from "@mantine/core";
import { descendantsOf, useMissionParents } from "./hierarchy.ts";
import type { Mission } from "./missions.ts";
import { useWrite } from "./shared.tsx";
import { setMissionParent } from "./writes.ts";

type Props = {
  mission: Mission;
  missions: Mission[];
  onOpen: (name: string) => void;
  clientUid: string | undefined;
  owner: boolean;
};

/** A feed's place in TAK Server's mission hierarchy: its parent and children; owners can move it. */
export const MissionFamily = ({ mission, missions, onOpen, clientUid, owner }: Props) => {
  const parents = useMissionParents(
    missions.map((m) => m.name),
    true,
  );
  const { busy, run } = useWrite();
  const parent = parents.get(mission.name);
  // Choosing safely needs every feed's parent: one not yet read could make a loop.
  const allKnown = missions.every((m) => parents.has(m.name));
  const children = missions
    .filter((m) => parents.get(m.name) === mission.name)
    .map((m) => m.name)
    .sort();
  // A feed can't move under itself or anything below it.
  const below = descendantsOf(mission.name, parents);
  const options = missions
    .map((m) => m.name)
    .filter((name) => name !== mission.name && !below.has(name))
    .sort();
  const link = (name: string) => (
    <Anchor key={name} component="button" type="button" fz="xs" onClick={() => onOpen(name)}>
      {name}
    </Anchor>
  );

  return (
    <Stack gap={4}>
      {owner && clientUid ? (
        <Select
          size="xs"
          label="Parent feed"
          description="Groups feeds on TAK Server; ATAK doesn't show it"
          placeholder={allKnown ? "None: a top-level feed" : "Reading feeds from TAK…"}
          data={options}
          value={parent ?? null}
          onChange={(next) =>
            void run("Parent feed not changed", () =>
              setMissionParent(mission.name, next ?? undefined, clientUid),
            )
          }
          disabled={busy || !allKnown}
          searchable
          clearable
          comboboxProps={{ withinPortal: true }}
        />
      ) : (
        parent && (
          <Text fz="xs" c="dimmed">
            Under {link(parent)}
          </Text>
        )
      )}
      {owner && parent && (
        <Text fz="xs" c="dimmed">
          Open {link(parent)}
        </Text>
      )}
      {children.length > 0 && (
        <Group gap={6} wrap="wrap">
          <Text fz="xs" c="dimmed">
            Child feeds:
          </Text>
          {children.map(link)}
        </Group>
      )}
    </Stack>
  );
};
