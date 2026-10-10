import {
  Alert,
  Button,
  Checkbox,
  Group,
  Input,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CREDIBILITY, RELIABILITY } from "../../admiralty.ts";
import { api, type EventResponse } from "../../api.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { Placeholder } from "../../Placeholder.tsx";
import {
  buildEvent,
  buildPatch,
  datetimeLocalValue,
  eventToValues,
  type FormConfig,
  type FormValues,
  fieldLabel,
  formEventType,
  missingRequired,
  type VisibleField,
} from "./widget.ts";

type Status = "idle" | "sending" | "sent" | "saved" | "error";

const dashboardRoute = getRouteApi("/d/$dashboardId");

const FormView = ({ config, onConfigure }: WidgetViewProps<FormConfig>) => {
  const [values, setValues] = useState<FormValues>({});
  const [status, setStatus] = useState<Status>("idle");
  const [problem, setProblem] = useState("");
  const [missingIds, setMissingIds] = useState<string[]>([]);
  /** The event being edited; null while composing a new one. */
  const [editing, setEditing] = useState<EventResponse | null>(null);
  /** A selected event held back because loading it would discard unsaved input. */
  const [offered, setOffered] = useState<EventResponse | null>(null);
  const dirty = useRef(false);
  /** Bumped whenever the form starts over, so a late save response can tell it's stale. */
  const generation = useRef(0);
  const editingId = useRef<string | undefined>(undefined);
  editingId.current = editing?.eventId;

  const { event: selectedId } = dashboardRoute.useSearch();
  const navigate = dashboardRoute.useNavigate();
  const clearSelection = () =>
    navigate({ search: (prev) => ({ ...prev, event: undefined }), replace: true });

  const startOver = (event: EventResponse | null) => {
    generation.current++;
    setEditing(event);
    setValues(event ? eventToValues(config, event) : {});
    setOffered(null);
    setMissingIds([]);
    setProblem("");
    setStatus("idle");
    dirty.current = false;
  };

  const eventType = formEventType(config);
  // biome-ignore lint/correctness/useExhaustiveDependencies: startOver is new every render; only a new selection should refetch
  useEffect(() => {
    setOffered(null);
    if (!config.allowEdit || !selectedId || selectedId === editingId.current) return;
    let alive = true;
    void (async () => {
      try {
        const res = await api.events[":eventId"].$get({ param: { eventId: selectedId } });
        if (!alive || res.status !== 200) return;
        const event = await res.json();
        if (!alive || event.type !== eventType) return;
        if (dirty.current) setOffered(event);
        else startOver(event);
      } catch {
        if (!alive) return;
        setStatus("error");
        setProblem("Could not load the selected event");
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId, eventType, config.allowEdit]);

  const set = (id: string, v: unknown) => {
    dirty.current = true;
    setValues((prev) => ({ ...prev, [id]: v }));
    // Typing into a flagged field clears its error immediately.
    setMissingIds((ids) => ids.filter((x) => x !== id));
  };

  const cancelEdit = () => {
    startOver(null);
    clearSelection();
  };

  /** Loads the current head over a stale edit, unless the user moved on since `started`. */
  const reloadLatest = async (eventId: string, started: number): Promise<boolean> => {
    try {
      const res = await api.events[":eventId"].$get({ param: { eventId } });
      if (res.status !== 200) return false;
      const latest = await res.json();
      if (generation.current !== started) return false;
      startOver(latest);
      return true;
    } catch {
      return false;
    }
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
    const started = generation.current;
    try {
      const res = editing
        ? await api.events[":eventId"].$patch({
            param: { eventId: editing.eventId },
            json: { ...buildPatch(config, values, editing), baseId: editing.id },
          })
        : await api.events.$post({ json: buildEvent(config, values) });
      if (res.ok) {
        // The user may have loaded another event meanwhile; don't wipe it.
        if (generation.current === started) {
          startOver(null);
          if (editing) clearSelection();
        }
        setStatus(editing ? "saved" : "sent");
        setTimeout(() => setStatus("idle"), 2000);
      } else if (res.status === 409 && editing) {
        if (generation.current !== started) return;
        const reloaded = await reloadLatest(editing.eventId, started);
        if (!reloaded && generation.current !== started) return;
        setStatus("error");
        setProblem(
          reloaded
            ? "Someone else changed this event — showing their version, re-apply your edit"
            : "Someone else changed this event — select it again",
        );
      } else {
        setStatus("error");
        setProblem(editing ? "Save failed" : "Send failed");
      }
    } catch {
      setStatus("error");
      setProblem("Send failed");
    }
  };

  const visible = config.fields.filter((f): f is VisibleField => f.kind !== "fixed");

  return (
    <Stack h="100%" gap="xs" p="xs">
      {offered && (
        <Alert p="xs" title={`Event “${offered.header}” selected`}>
          <Text fz="xs">Load it? Your unsaved input will be lost.</Text>
          <Group gap="xs" mt="xs">
            <Button size="compact-xs" onClick={() => startOver(offered)}>
              Load
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                setOffered(null);
                clearSelection();
              }}
            >
              Keep my input
            </Button>
          </Group>
        </Alert>
      )}
      {editing && (
        <Text fz="xs" c="dimmed" truncate>
          Editing “{editing.header}”
        </Text>
      )}
      <Stack gap="xs" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {visible.length === 0 ? (
          <Placeholder
            title="No fields yet"
            detail="A form needs at least one field before it can post an event."
            action={{ label: "Add fields", onClick: onConfigure }}
          />
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
          {status === "sent" ? "Sent ✓" : status === "saved" ? "Saved ✓" : problem}
        </Text>
        <Group gap="xs" wrap="nowrap">
          {editing && (
            <Button size="xs" variant="subtle" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
          <Button
            size="xs"
            onClick={submit}
            loading={status === "sending"}
            disabled={visible.length === 0}
          >
            {editing ? "Save changes" : config.submitLabel?.trim() || "Submit"}
          </Button>
        </Group>
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

export default FormView;
