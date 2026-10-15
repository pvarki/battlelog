import { Anchor, Box, Center, Group, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { DashboardResponse } from "../api.ts";
import { Placeholder } from "../components/Placeholder.tsx";
import { StaleNotice } from "../components/StaleNotice.tsx";
import { LayoutThumbnail } from "../dashboard/LayoutThumbnail.tsx";
import { RECENT_KEY } from "../dashboard/recent.ts";
import { useLiveEvents } from "../events/live-events.ts";
import { useStoredSetting } from "../stored-setting.ts";
import { useIsMobile } from "../viewport.ts";
import { FeedTable } from "../widgets/feed/View.tsx";
import type { FeedColumn } from "../widgets/feed/widget.ts";

const route = getRouteApi("__root__");

// The list column is the narrow half of the split; the log gets the rest.
const LIST_WIDTH = 400;

const ACTIVITY_ROWS = 40;

// Reuses the feed widget's table rather than a second one: an event arriving
// here then washes exactly as it does inside a dashboard.
const ACTIVITY_COLUMNS: FeedColumn[] = [
  { id: "time", label: "", source: "time", dataPath: "" },
  { id: "header", label: "", source: "header", dataPath: "" },
  { id: "type", label: "", source: "type", dataPath: "" },
  { id: "tags", label: "", source: "tags", dataPath: "" },
];

/**
 * The log, on the landing page. Picking a dashboard is a navigation choice, and
 * it used to be the only thing here — so the first screen of a
 * situational-awareness tool showed no situation. The stream is already open on
 * this route (the header's connection indicator holds it), so this costs a fetch.
 */
const LatestActivity = () => {
  const { events, failed, arrived } = useLiveEvents({ limit: ACTIVITY_ROWS });
  return (
    <Paper withBorder flex={1} mih={0} miw={0} style={{ display: "flex", flexDirection: "column" }}>
      <Group justify="space-between" px="sm" py="xs" wrap="nowrap">
        <Text fw={600} fz="sm">
          Latest activity
        </Text>
        <Anchor fz="xs" renderRoot={(props) => <Link to="/events" {...props} />}>
          Search all events
        </Anchor>
      </Group>
      <Box flex={1} mih={0} px="sm" pb="sm" style={{ overflowY: "auto" }}>
        {!events ? (
          <Center h="100%">
            <Loader size="sm" />
          </Center>
        ) : events.length === 0 ? (
          <Placeholder
            title={failed ? "Couldn't load the log" : "Nothing logged yet"}
            detail={
              failed
                ? "New events will still arrive on the live stream."
                : "Events posted to BattleLog appear here the moment they arrive."
            }
          />
        ) : (
          <>
            {failed && <StaleNotice />}
            <FeedTable columns={ACTIVITY_COLUMNS} events={events} arrived={arrived} relativeTime />
          </>
        )}
      </Box>
    </Paper>
  );
};

export const DashboardsPage = () => {
  // Phones get a plain picker: just the dashboards, whole row tappable. No
  // create/rename/delete/import/templates and no activity feed — managing
  // boards is desktop work, a phone is for getting to one.
  const isMobile = useIsMobile();
  return isMobile ? <MobileDashboards /> : <DesktopDashboards />;
};

const MobileDashboards = () => {
  const all = route.useLoaderData();
  const dashboards = all.filter((d) => !d.isTemplate);
  return (
    <Box p="md" h="calc(100dvh - 48px)" style={{ overflowY: "auto" }}>
      {dashboards.length === 0 ? (
        <Placeholder
          title="No views yet"
          detail="Views are created and managed on a desktop screen."
        />
      ) : (
        <Stack gap="xs">
          {dashboards.map((d) => (
            <Paper
              key={d.id}
              withBorder
              p="md"
              renderRoot={(props) => (
                <Link to="/d/$dashboardId" params={{ dashboardId: d.id }} {...props} />
              )}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <Group wrap="nowrap" align="center" gap="sm">
                <LayoutThumbnail widgets={d.widgets} />
                <Box mih={0} style={{ flex: 1 }}>
                  <Text fw={600}>{d.name}</Text>
                  {d.description && (
                    <Text fz="sm" c="dimmed" lineClamp={2}>
                      {d.description}
                    </Text>
                  )}
                </Box>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
};

// Recents are per device: whatever this screen opened last. Favorites and the
// full list live in the side panel.
const DesktopDashboards = () => {
  const all = route.useLoaderData();
  const [recentIds] = useStoredSetting<string[]>({ key: RECENT_KEY, defaultValue: [] });
  const views = all.filter((d) => !d.isTemplate);
  const recent = recentIds
    .map((id) => views.find((d) => d.id === id))
    .filter((d) => d !== undefined);

  return (
    <Box p="md" h="calc(100dvh - 48px)" style={{ display: "flex", flexDirection: "column" }}>
      <Group align="stretch" gap="md" wrap="nowrap" flex={1} mih={0}>
        <Stack w={LIST_WIDTH} gap="sm" mih={0} style={{ flexShrink: 0, overflowY: "auto" }}>
          <Title order={4}>Recently opened</Title>
          {recent.length === 0 ? (
            <Text fz="sm" c="dimmed">
              Views you open on this device show up here. Pick one from the side panel.
            </Text>
          ) : (
            <Stack gap="xs">{recent.map(card)}</Stack>
          )}
        </Stack>

        <LatestActivity />
      </Group>
    </Box>
  );
};

const card = (d: DashboardResponse) => (
  <Paper
    key={d.id}
    withBorder
    p="sm"
    renderRoot={(props) => <Link to="/d/$dashboardId" params={{ dashboardId: d.id }} {...props} />}
    style={{ textDecoration: "none", color: "inherit" }}
  >
    <Group wrap="nowrap" align="center" gap="sm">
      <LayoutThumbnail widgets={d.widgets} />
      <Box mih={0} style={{ flex: 1 }}>
        <Text fw={600}>{d.name}</Text>
        {d.description && (
          <Text fz="xs" c="dimmed" lineClamp={2}>
            {d.description}
          </Text>
        )}
      </Box>
    </Group>
  </Paper>
);
