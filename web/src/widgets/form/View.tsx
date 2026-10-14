import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Input,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { IconCurrentLocation, IconMapPin } from "@tabler/icons-react";
import { getRouteApi } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CREDIBILITY, RELIABILITY } from "../../admiralty.ts";
import { api, type EventResponse } from "../../api.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { eventLabel } from "../../event-binding/paths.ts";
import { queryFilter } from "../../event-binding/query.ts";
import { useLiveEvents } from "../../live-events.ts";
import { answerPick, canPick, requestPick } from "../../map-pick.ts";
import { Placeholder } from "../../Placeholder.tsx";
import { matchesFeed, queryFor } from "../feed/widget.ts";
import { FormPrint } from "./Print.tsx";
import {
  buildEvent,
  buildPatch,
  datetimeLocalValue,
  type EventReference,
  type EventSelect,
  eventToValues,
  type FormConfig,
  type FormValues,
  fieldLabel,
  formEventType,
  isReference,
  missingRequired,
  type PendingWriteBack,
  pendingWriteBacks,
  type VisibleField,
  writeBackData,
} from "./widget.ts";

type Status = "idle" | "sending" | "sent" | "saved" | "error";

const dashboardRoute = getRouteApi("/d/$dashboardId");

// Only a form whose pick finds no map on screen pays for loading one.
const TakWorkspace = lazy(() =>
  import("../../tak/TakWorkspace.tsx").then((m) => ({ default: m.TakWorkspace })),
);

const toMicroDegrees = (degrees: number) => Math.round(degrees * 1e6) / 1e6;

/**
 * Sets the rules' fields on the picked event, merged into its current data
 * with `baseId`; one retry on a 409 (someone saved it in between). Returns
 * whether it landed.
 */
const applyWriteBack = async (
  { target, rules }: PendingWriteBack,
  submitted: EventReference,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await api.events[":eventId"].$get({ param: { eventId: target.eventId } });
    if (head.status !== 200) return false;
    const row = await head.json();
    const res = await api.events[":eventId"].$patch({
      param: { eventId: target.eventId },
      json: { data: writeBackData(row.data, rules, submitted), baseId: row.id },
    });
    if (res.ok) return true;
    if (res.status !== 409) return false;
  }
  return false;
};

const FormView = ({ config, onConfigure }: WidgetViewProps<FormConfig>) => {
  const [values, setValues] = useState<FormValues>({});
  const [status, setStatus] = useState<Status>("idle");
  const [problem, setProblem] = useState("");
  const [missingIds, setMissingIds] = useState<string[]>([]);
  /** The event being edited; null while composing a new one. */
  const [editing, setEditing] = useState<EventResponse | null>(null);
  /** Unresolved write-backs per saved submission, kept until retried successfully or dismissed. */
  const [failedWriteBacks, setFailedWriteBacks] = useState<
    { pending: PendingWriteBack[]; submitted: EventReference }[]
  >([]);
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

  /** The field waiting for a map click; `inModal` when no map on screen could take it. */
  const [picking, setPicking] = useState<{ fieldId: string; inModal: boolean }>();
  const withdrawPick = useRef<() => void>(undefined);
  useEffect(() => () => withdrawPick.current?.(), []);

  const stopPicking = () => {
    withdrawPick.current?.();
    setPicking(undefined);
  };

  const pickOnMap = (field: VisibleField) => {
    const again = picking?.fieldId === field.id;
    stopPicking();
    if (again) return;
    const started = generation.current;
    const inModal = !canPick();
    withdrawPick.current = requestPick({
      label: fieldLabel(field),
      onPick: ([lng, lat]) => {
        setPicking(undefined);
        if (generation.current !== started) return;
        set(field.id, { lat: toMicroDegrees(lat), lng: toMicroDegrees(lng) });
      },
      onCancel: () => setPicking(undefined),
    });
    setPicking({ fieldId: field.id, inModal });
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      notifications.show({ color: "red", message: "This browser can't share your location" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => answerPick([coords.longitude, coords.latitude]),
      () => notifications.show({ color: "red", message: "Could not get your location" }),
    );
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

  /** Bumped on Dismiss, so a retry still in flight can't bring dismissed failures back. */
  const dismissals = useRef(0);

  const runWriteBacks = async (pending: PendingWriteBack[], submitted: EventReference) => {
    const started = dismissals.current;
    const results = await Promise.all(
      pending.map((w) => applyWriteBack(w, submitted).catch(() => false)),
    );
    const failed = pending.filter((_, i) => !results[i]);
    if (dismissals.current !== started) return failed;
    setFailedWriteBacks((all) => [
      ...all.filter((f) => f.submitted.eventId !== submitted.eventId),
      ...(failed.length ? [{ pending: failed, submitted }] : []),
    ]);
    return failed;
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
    // Captured before startOver clears the values; edits don't re-run write-backs.
    const writeBacks = editing ? [] : pendingWriteBacks(config, values);
    try {
      const res = editing
        ? await api.events[":eventId"].$patch({
            param: { eventId: editing.eventId },
            json: { ...buildPatch(config, values, editing), baseId: editing.id },
          })
        : await api.events.$post({ json: buildEvent(config, values) });
      if (res.ok) {
        const saved = await res.json();
        // The user may have loaded another event meanwhile; don't wipe it.
        if (generation.current === started) {
          startOver(null);
          if (editing) clearSelection();
        }
        const failed = writeBacks.length
          ? await runWriteBacks(writeBacks, { eventId: saved.eventId, label: saved.header })
          : [];
        if (failed.length) {
          setStatus("error");
          setProblem(`Sent, but couldn't update ${failed.map((w) => w.label).join(", ")}`);
          return;
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
    <>
      <FormPrint fields={config.fields} />
      <Modal opened={!!picking?.inModal} onClose={stopPicking} title="Pick a location" size="xl">
        <Stack gap="xs">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconCurrentLocation size={14} />}
            style={{ alignSelf: "flex-start" }}
            onClick={locateMe}
          >
            Use my location
          </Button>
          <div style={{ height: "60vh" }}>
            <Suspense fallback={<Loader size="sm" />}>
              <TakWorkspace tools={new Set()} embedded pickable />
            </Suspense>
          </div>
        </Stack>
      </Modal>
      <Stack h="100%" gap="xs" p="xs" className="screen-only">
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
        {failedWriteBacks.length > 0 && (
          <Alert p="xs" color="orange" title="Linked events not updated">
            {failedWriteBacks.map(({ pending, submitted }) => (
              <Text key={submitted.eventId} fz="xs">
                “{submitted.label}” was saved, but {pending.map((w) => w.label).join(", ")} couldn't
                be updated.
              </Text>
            ))}
            <Group gap="xs" mt="xs">
              <Button
                size="compact-xs"
                onClick={async () => {
                  const results = await Promise.all(
                    failedWriteBacks.map((f) => runWriteBacks(f.pending, f.submitted)),
                  );
                  const stillFailing = results.some((failed) => failed.length);
                  setStatus(stillFailing ? "error" : "idle");
                  setProblem(stillFailing ? "Update failed again" : "");
                }}
              >
                Retry
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => {
                  dismissals.current++;
                  setFailedWriteBacks([]);
                }}
              >
                Dismiss
              </Button>
            </Group>
          </Alert>
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
                picking={picking?.fieldId === f.id}
                onPickOnMap={() => pickOnMap(f)}
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
    </>
  );
};

const FieldInput = ({
  field,
  value,
  error,
  onChange,
  picking,
  onPickOnMap,
}: {
  field: VisibleField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  picking: boolean;
  onPickOnMap: () => void;
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
      case "event":
        return (
          <EventSelectInput
            common={common}
            select={field.eventSelect}
            value={isReference(value) ? value : undefined}
            onChange={onChange}
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
          <DateTimePicker
            {...common}
            placeholder="Select date and time"
            locale="fi"
            value={typeof value === "string" && value ? value.replace("T", " ") : null}
            valueFormat="DD.MM.YYYY HH:mm"
            timePickerProps={{ minutesStep: 5 }}
            onChange={(next) => onChange(next?.replace(" ", "T") ?? undefined)}
          />
          {!field.hideNowButton && (
            <Button
              size="compact-xs"
              variant="light"
              style={{ alignSelf: "flex-start" }}
              onClick={() => onChange(datetimeLocalValue())}
            >
              Nyt
            </Button>
          )}
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
          <Group gap="xs" wrap="nowrap">
            <NumberInput
              aria-label="Latitude"
              style={{ flex: 1 }}
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
              style={{ flex: 1 }}
              placeholder="Lng"
              size="xs"
              hideControls
              decimalScale={6}
              min={-180}
              max={180}
              value={p.lng ?? ""}
              onChange={(v) => onChange({ ...p, lng: v === "" ? undefined : v })}
            />
            <ActionIcon
              size="input-xs"
              variant={picking ? "filled" : "default"}
              aria-label="Pick on map"
              aria-pressed={picking}
              title="Pick on map"
              onClick={onPickOnMap}
            >
              <IconMapPin size={16} />
            </ActionIcon>
          </Group>
        </Input.Wrapper>
      );
    }
  }
};

type CommonProps = {
  label: string;
  description?: string;
  required?: boolean;
  error?: string;
  size: "xs";
};

const EventSelectInput = ({
  common,
  select,
  value,
  onChange,
}: {
  common: CommonProps;
  select: EventSelect | undefined;
  value: EventReference | undefined;
  onChange: (v: EventReference | undefined) => void;
}) => {
  const filter = select && queryFilter(select);
  if (!select || !filter) {
    return <Select {...common} data={[]} disabled placeholder="Options not configured" />;
  }
  return (
    <LiveEventSelect
      common={common}
      select={select}
      filter={filter}
      value={value}
      onChange={onChange}
    />
  );
};

const LiveEventSelect = ({
  common,
  select,
  filter,
  value,
  onChange,
}: {
  common: CommonProps;
  select: EventSelect;
  filter: NonNullable<ReturnType<typeof queryFilter>>;
  value: EventReference | undefined;
  onChange: (v: EventReference | undefined) => void;
}) => {
  const { events } = useLiveEvents({
    limit: 100,
    query: queryFor(filter),
    match: (event) => matchesFeed(event, filter),
  });
  const options = (events ?? [])
    .map((e) => ({ value: e.eventId, label: eventLabel(e, select.labelField) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // An edited submission keeps its pick even when that event no longer matches
  // (e.g. the drone is now "in-mission"): shown with its stored label.
  if (value && !options.some((o) => o.value === value.eventId)) {
    options.unshift({ value: value.eventId, label: value.label });
  }
  const empty = events !== null && options.length === 0;
  return (
    <Select
      {...common}
      clearable
      searchable
      data={options}
      disabled={empty}
      placeholder={
        events === null
          ? "Loading…"
          : empty
            ? select.emptyText.trim() || "No options available"
            : undefined
      }
      value={value?.eventId ?? null}
      onChange={(id) => {
        const option = options.find((o) => o.value === id);
        onChange(option ? { eventId: option.value, label: option.label } : undefined);
      }}
    />
  );
};

export default FormView;
