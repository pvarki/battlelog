import {
  Button,
  Checkbox,
  Group,
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
import {
  buildEvent,
  EVENT_FIELDS,
  type FormConfig,
  type FormField,
  type FormValues,
  missingRequired,
} from "./widget.ts";

type Status = "idle" | "sending" | "sent" | "error";

const FormView = ({ config }: WidgetViewProps<FormConfig>) => {
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

  const visible = config.fields.filter((f) => f.kind !== "fixed");

  return (
    <Stack h="100%" gap="xs" p="xs">
      <Stack gap="xs" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {visible.length === 0 ? (
          <Text c="dimmed" fz="sm">
            No fields configured — add some in settings.
          </Text>
        ) : (
          visible.map((f) => (
            <FieldInput
              key={f.id}
              field={f}
              value={values[f.id]}
              error={missingIds.includes(f.id) ? "Required" : undefined}
              onChange={(v) => set(f.id, v)}
            />
          ))
        )}
      </Stack>
      <Group justify="space-between" wrap="nowrap">
        <Text
          c={status === "error" ? "red.4" : "dimmed"}
          fz="xs"
          style={{ minWidth: 0 }}
          role="status"
        >
          {status === "sent" ? "Sent ✓" : problem}
        </Text>
        <Button
          size="xs"
          onClick={submit}
          loading={status === "sending"}
          disabled={visible.length === 0}
        >
          {config.submitLabel?.trim() || "Submit"}
        </Button>
      </Group>
    </Stack>
  );
};

const FieldInput = ({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) => {
  if (field.kind === "fixed") return null;

  if (field.kind === "data") {
    const common = { label: field.label, required: field.required, error, size: "xs" as const };
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
            label={field.label}
            required={field.required}
            error={error}
            size="xs"
            checked={value === true}
            onChange={(e) => onChange(e.currentTarget.checked)}
          />
        );
    }
  }

  const common = {
    label: EVENT_FIELDS[field.field],
    required: field.required,
    error,
    size: "xs" as const,
  };
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
        <TextInput
          {...common}
          type="datetime-local"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
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
        <Group gap="xs" grow>
          <NumberInput
            label="Lat"
            required={field.required}
            error={error}
            size="xs"
            hideControls
            decimalScale={6}
            min={-90}
            max={90}
            value={p.lat ?? ""}
            onChange={(v) => onChange({ ...p, lat: v === "" ? undefined : v })}
          />
          <NumberInput
            label="Lng"
            required={field.required}
            size="xs"
            hideControls
            decimalScale={6}
            min={-180}
            max={180}
            value={p.lng ?? ""}
            onChange={(v) => onChange({ ...p, lng: v === "" ? undefined : v })}
          />
        </Group>
      );
    }
  }
};

export default FormView;
