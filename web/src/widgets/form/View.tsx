import {
  Button,
  Center,
  Checkbox,
  Group,
  Input,
  Modal,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { CREDIBILITY, RELIABILITY } from "../../admiralty.ts";
import { api } from "../../api.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { Placeholder } from "../../Placeholder.tsx";
import {
  buildEvent,
  datetimeLocalValue,
  type FormConfig,
  type FormValues,
  fieldLabel,
  missingRequired,
  type VisibleField,
} from "./widget.ts";

type Status = "idle" | "sending" | "sent" | "error";

const FieldInput = ({
  field,
  value,
  error,
  onChange,
}: {
  field: VisibleField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) => {
  const common = {
    label: fieldLabel(field),
    description: field.description?.trim() || undefined,
    required: field.required,
    error,
    size: "xs" as const,
  };

  if (field.kind === "data") {
    switch (field.input) {
      case "text":
        return (
          <TextInput
            {...common}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        );
      case "textarea":
        return (
          <Textarea
            {...common}
            autosize
            minRows={2}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        );
      case "number":
        return (
          <NumberInput
            {...common}
            hideControls
            value={(value as number) ?? ""}
            onChange={(v) => onChange(v === "" ? undefined : v)}
          />
        );
      case "select":
        return (
          <Select
            {...common}
            clearable
            data={field.options}
            value={(value as string) ?? null}
            onChange={(v) => onChange(v ?? undefined)}
          />
        );
      case "checkbox":
        return (
          <Checkbox
            {...common}
            checked={value === true}
            onChange={(e) => onChange(e.currentTarget.checked)}
          />
        );
    }
  }

  switch (field.field) {
    case "header":
    case "location":
    case "sourceUri":
      return (
        <TextInput
          {...common}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
    case "eventTime":
      return (
        <Stack gap={4}>
          <TextInput
            {...common}
            type="datetime-local"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
          <Button
            size="compact-xs"
            variant="light"
            style={{ alignSelf: "flex-start" }}
            onClick={() => onChange(datetimeLocalValue())}
          >
            Nyt
          </Button>
        </Stack>
      );
    case "tags":
    case "hcoeDomains":
      return (
        <TagsInput {...common} value={(value as string[]) ?? []} onChange={(v) => onChange(v)} />
      );
    case "admiraltyReliability":
    case "admiraltyAccuracy":
      return (
        <Select
          {...common}
          clearable
          data={[...(field.field === "admiraltyReliability" ? RELIABILITY : CREDIBILITY)]}
          value={(value as string) ?? null}
          onChange={(v) => onChange(v ?? undefined)}
        />
      );
    case "locationPoint": {
      const p = (value as { lat?: number | string; lng?: number | string }) ?? {};
      return (
        <Input.Wrapper {...common}>
          <Group gap="xs" grow>
            <NumberInput
              aria-label="Latitude"
              placeholder="Lat"
              size="xs"
              hideControls
              decimalScale={6}
              min={-90}
              max={90}
              value={p.lat ?? ""}
              onChange={(v) => onChange({ ...p, lat: v === "" ? undefined : v })}
            />
            <NumberInput
              aria-label="Longitude"
              placeholder="Lng"
              size="xs"
              hideControls
              decimalScale={6}
              min={-180}
              max={180}
              value={p.lng ?? ""}
              onChange={(v) => onChange({ ...p, lng: v === "" ? undefined : v })}
            />
          </Group>
        </Input.Wrapper>
      );
    }
  }
};

const FormView = ({ config, onConfigure }: WidgetViewProps<FormConfig>) => {
  // The form lives behind a button: on a dashboard the tile is small, and a
  // half-visible form is worse than one that opens with room to fill in.
  const [opened, setOpened] = useState(false);
  const [values, setValues] = useState<FormValues>({});
  const [status, setStatus] = useState<Status>("idle");
  const [problem, setProblem] = useState("");
  const [missingIds, setMissingIds] = useState<string[]>([]);

  const set = (id: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    // Typing into a flagged field clears its error immediately.
    setMissingIds((ids) => ids.filter((x) => x !== id));
  };

  const submit = async () => {
    const missing = missingRequired(config, values);
    if (missing.length) {
      setStatus("error");
      setProblem(`Required: ${missing.map((m) => m.label).join(", ")}`);
      setMissingIds(missing.map((m) => m.id));
      return;
    }
    setStatus("sending");
    setProblem("");
    setMissingIds([]);
    try {
      const res = await api.events.$post({ json: buildEvent(config, values) });
      if (res.status === 201) {
        setValues({});
        setStatus("sent");
        // Close on success: the entry is filed, and the confirmation belongs on
        // the tile where it stays visible.
        setOpened(false);
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus("error");
        setProblem("Send failed");
      }
    } catch {
      setStatus("error");
      setProblem("Send failed");
    }
  };

  const visible = config.fields.filter((f): f is VisibleField => f.kind !== "fixed");

  const openLabel = config.title?.trim() || config.submitLabel?.trim() || "Add entry";

  if (visible.length === 0) {
    return (
      <Stack h="100%" gap="xs" p="xs">
        <Placeholder
          title="No fields yet"
          detail="A form needs at least one field before it can post an event."
          action={{ label: "Add fields", onClick: onConfigure }}
        />
      </Stack>
    );
  }

  return (
    <Stack h="100%" gap="xs" p="xs">
      <Center style={{ flex: 1, minHeight: 0 }}>
        <Button
          size="md"
          fullWidth
          h="100%"
          onClick={() => setOpened(true)}
          styles={{ label: { whiteSpace: "normal", lineHeight: 1.2 } }}
        >
          {openLabel}
        </Button>
      </Center>
      <Text
        c={status === "error" ? "red.4" : "dimmed"}
        fz="xs"
        ta="center"
        mih="1.2em"
        role="status"
      >
        {status === "sent" ? "Sent ✓" : problem}
      </Text>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={openLabel}
        size="lg"
        // Long forms scroll inside the modal rather than pushing it off screen.
        scrollAreaComponent={undefined}
      >
        <Stack gap="xs">
          {visible.map((f) => (
            <FieldInput
              key={f.id}
              field={f}
              value={values[f.id]}
              error={missingIds.includes(f.id) ? "Required" : undefined}
              onChange={(v) => set(f.id, v)}
            />
          ))}
          <Group justify="space-between" wrap="nowrap" mt="sm">
            <Text c={status === "error" ? "red.4" : "dimmed"} fz="xs" style={{ minWidth: 0 }}>
              {problem}
            </Text>
            <Button onClick={submit} loading={status === "sending"}>
              {config.submitLabel?.trim() || "Submit"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FormView;
