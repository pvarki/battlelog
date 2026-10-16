import { Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { Placeholder } from "../../components/Placeholder.tsx";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useWidgetDocument } from "../../dashboard/useEventDocument.ts";
import { ChoiceChip, CountChip, countOf, ValueCell } from "../../event-binding/cells.tsx";
import { matchesFeed, queryFor } from "../../event-binding/filter.ts";
import type { ValueSpec } from "../../event-binding/options.ts";
import { eventLabel } from "../../event-binding/paths.ts";
import { queryFilter } from "../../event-binding/query.ts";
import { useBoundEvents } from "../../event-binding/useBoundEvents.ts";
import { useLiveEvents } from "../../events/live-events.ts";
import { buildStatusTree, flattenTree } from "./tree.ts";
import { type StatusConfig, type StatusGroup, type StatusRow, widgetDocument } from "./widget.ts";

type Bound = ReturnType<typeof useBoundEvents>;

const boundCell = (bound: Bound, spec: ValueSpec, eventId: string, field: string) => (
  <ValueCell
    spec={spec}
    state={bound.resolve(eventId, field)}
    field={field}
    onWrite={(value) => bound.write(eventId, field, value)}
    onFlush={() => void bound.flush(eventId)}
  />
);

const StatusView = ({
  config,
  dashboardIsTemplate,
  updateConfig,
  onConfigure,
}: WidgetViewProps<StatusConfig>) => {
  const { value, update, status } = useWidgetDocument({
    config,
    updateConfig,
    dashboardIsTemplate,
    document: widgetDocument,
  });

  const bound = useBoundEvents(
    config.statuses.flatMap((r) => (r.source && !r.group ? [r.source.eventId.trim()] : [])),
  );

  // ponytail: whole-object last-writer-wins — two screens editing different
  // rows within the same save window can drop each other's field (SSE
  // catch-up self-heals on the next update). Per-row events or server-side
  // jsonb merge if boards get busy.
  const setRowValue = (rowId: string, next: string | number) => {
    update({ values: { ...value.values, [rowId]: next } });
  };

  if (config.statuses.length === 0) {
    return (
      <Placeholder
        title="No statuses yet"
        detail="Add the units or tasks this board should track."
        action={{ label: "Add statuses", onClick: onConfigure }}
      />
    );
  }

  const sections = toSections(config.statuses);

  return (
    <Stack gap={6} p="xs" h="100%" style={{ overflowY: "auto" }}>
      {sections.map((section) =>
        section.group ? (
          <DynamicGroup key={section.row.id} row={section.row} group={section.group} />
        ) : (
          flattenTree(buildStatusTree(section.rows)).map((node) => {
            const row = node.row;
            const source = row?.source;
            return (
              <Group
                key={row?.id ?? node.path}
                justify="space-between"
                wrap="nowrap"
                pl={node.depth * 16}
              >
                <Tooltip
                  label={row?.description}
                  disabled={!row?.description?.trim()}
                  openDelay={600}
                  multiline
                  maw={320}
                  position="top-start"
                >
                  <Text
                    fz="sm"
                    truncate
                    fw={node.children.length > 0 ? 600 : undefined}
                    style={row?.description?.trim() ? { cursor: "help" } : undefined}
                  >
                    {node.name}
                  </Text>
                </Tooltip>
                {row && source
                  ? boundCell(bound, row, source.eventId.trim(), source.field)
                  : row &&
                    row.kind !== "text" &&
                    (row.kind === "count" ? (
                      <CountChip
                        count={countOf(value.values[row.id])}
                        onChange={(n) => setRowValue(row.id, n)}
                      />
                    ) : (
                      <ChoiceChip
                        options={row.options}
                        current={value.values[row.id]}
                        onChange={(v) => setRowValue(row.id, v)}
                      />
                    ))}
              </Group>
            );
          })
        ),
      )}
      <Text c="dimmed" fz="xs" ta="right" mt="auto" mih="1.2em" role="status">
        {DOC_STATUS_LABEL[status]}
      </Text>
    </Stack>
  );
};

type Section = { group?: undefined; rows: StatusRow[] } | { group: StatusGroup; row: StatusRow };

/** Static rows keep the label tree; each dynamic row is its own section. Order follows the config. */
const toSections = (rows: StatusRow[]): Section[] => {
  const sections: Section[] = [];
  for (const row of rows) {
    if (row.group) {
      sections.push({ group: row.group, row });
      continue;
    }
    const last = sections.at(-1);
    if (last && !last.group) last.rows.push(row);
    else sections.push({ rows: [row] });
  }
  return sections;
};

const DynamicGroup = ({ row, group }: { row: StatusRow; group: StatusGroup }) => {
  const filter = queryFilter(group);
  return (
    <Stack gap={6}>
      <Text fz="sm" fw={600} truncate>
        {row.label}
      </Text>
      {!filter ? (
        <Text c="dimmed" fz="xs" pl={16}>
          Set at least one event type
        </Text>
      ) : group.layout === "list" && !group.field.trim() ? (
        <Text c="dimmed" fz="xs" pl={16}>
          Set the field to show
        </Text>
      ) : group.layout === "sections" && group.properties.length === 0 ? (
        <Text c="dimmed" fz="xs" pl={16}>
          Add at least one property
        </Text>
      ) : (
        <GroupRows row={row} group={group} filter={filter} />
      )}
    </Stack>
  );
};

const GroupRows = ({
  row,
  group,
  filter,
}: {
  row: StatusRow;
  group: StatusGroup;
  filter: NonNullable<ReturnType<typeof queryFilter>>;
}) => {
  const { events, failed } = useLiveEvents({
    limit: 100,
    query: queryFor(filter),
    match: (event) => matchesFeed(event, filter),
  });
  const bound = useBoundEvents([], events ?? []);

  if (!events) return <Loader size="xs" ml={16} />;
  if (events.length === 0) {
    return (
      <Placeholder
        title={failed ? "Couldn't load events" : "No matching events"}
        detail={
          failed
            ? "New ones will still arrive on the live stream."
            : "Nothing in the log matches this group's query."
        }
      />
    );
  }
  const sorted = [...events].sort((a, b) => a.header.localeCompare(b.header));
  if (group.layout === "sections") {
    return sorted.map((event) => (
      <Stack key={event.eventId} gap={4} pl={16}>
        <Text fz="sm" fw={600} truncate>
          {eventLabel(event, group.labelField)}
        </Text>
        {group.properties.map((property) => (
          <Group key={property.id} justify="space-between" wrap="nowrap" pl={16}>
            <Text fz="sm" truncate>
              {property.label.trim() || property.field}
            </Text>
            {property.field.trim() ? (
              boundCell(bound, property, event.eventId, property.field)
            ) : (
              <Text c="dimmed" fz="xs">
                set field
              </Text>
            )}
          </Group>
        ))}
      </Stack>
    ));
  }
  return sorted.map((event) => (
    <Group key={event.eventId} justify="space-between" wrap="nowrap" pl={16}>
      <Text fz="sm" truncate>
        {event.header}
      </Text>
      {boundCell(bound, row, event.eventId, group.field)}
    </Group>
  ));
};

export default StatusView;
