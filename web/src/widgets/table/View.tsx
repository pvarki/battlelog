import { ActionIcon, Button, Stack, Table, Text, TextInput } from "@mantine/core";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useEventDocument } from "../../dashboard/useEventDocument.ts";
import { evaluateFormula } from "./formula.ts";
import { parseRows, type TableConfig, type TableDoc } from "./widget.ts";

const TableView = ({ config, updateConfig }: WidgetViewProps<TableConfig>) => {
  const { value, update, flush, status } = useEventDocument<TableDoc>({
    eventId: config.eventId,
    eventType: "table",
    headerFor: () => config.title?.trim() || "Table",
    empty: { rows: [] },
    parse: parseRows,
    onEventIdCaptured: (id) => updateConfig({ ...config, eventId: id }),
    debounceMs: 2000,
  });

  // ponytail: whole-doc last-writer-wins, same as the status widget — two
  // screens editing different rows within one save window can drop each
  // other's edit (SSE catch-up self-heals). Per-row events if tables get busy.
  const setCell = (rowIndex: number, columnId: string, text: string) => {
    update({
      rows: value.rows.map((row, i) => (i === rowIndex ? { ...row, [columnId]: text } : row)),
    });
  };

  if (config.columns.length === 0) {
    return (
      <Text c="dimmed" fz="sm" ta="center" mt="md">
        No columns yet — configure them in Settings.
      </Text>
    );
  }

  return (
    <Stack gap={4} p="xs" h="100%" style={{ overflow: "auto" }}>
      <Table withColumnBorders verticalSpacing={2} horizontalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            {config.columns.map((col) => (
              <Table.Th key={col.id}>{col.label}</Table.Th>
            ))}
            <Table.Th w={32} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {value.rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id and are edited in place
            <Table.Tr key={rowIndex}>
              {config.columns.map((col) => (
                <Table.Td key={col.id} p={0}>
                  {col.kind === "formula" ? (
                    <Text fz="sm" px={6} c="dimmed">
                      {evaluateFormula(col.formula ?? "", row, config.columns)}
                    </Text>
                  ) : (
                    <TextInput
                      size="xs"
                      variant="unstyled"
                      px={6}
                      value={row[col.id] ?? ""}
                      onChange={(e) => setCell(rowIndex, col.id, e.currentTarget.value)}
                      onBlur={flush}
                      disabled={status === "loading" || status === "unavailable"}
                    />
                  )}
                </Table.Td>
              ))}
              <Table.Td p={0} ta="center">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Remove row ${rowIndex + 1}`}
                  onClick={() => update({ rows: value.rows.filter((_, i) => i !== rowIndex) })}
                >
                  ✕
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Button
        size="compact-xs"
        variant="subtle"
        style={{ alignSelf: "flex-start" }}
        disabled={status === "loading" || status === "unavailable"}
        onClick={() => update({ rows: [...value.rows, {}] })}
      >
        Add row
      </Button>
      <Text c="dimmed" fz="xs" ta="right" mt="auto" mih="1.2em" role="status">
        {DOC_STATUS_LABEL[status]}
      </Text>
    </Stack>
  );
};

export default TableView;
