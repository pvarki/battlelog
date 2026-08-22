import { Stack, Text, Textarea } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { headerFor, type NoteConfig } from "./widget.ts";

const SAVE_DEBOUNCE_MS = 2000;

type Status = "idle" | "loading" | "waiting" | "saving" | "saved" | "error" | "stale";

const STATUS_LABEL: Record<Status, string> = {
  idle: "",
  loading: "Loading…",
  waiting: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
  stale: "Updated elsewhere — reloaded",
};

const NoteView = ({ config, updateConfig }: WidgetViewProps<NoteConfig>) => {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>(config.eventId ? "loading" : "idle");
  const eventId = useRef(config.eventId);
  // Id the view captured itself on first save — its config echo must not
  // trigger a reload. A plain ref-equality guard breaks under StrictMode's
  // double-run (the first run's fetch gets cancelled, the second run skips).
  const selfCaptured = useRef<string | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Latest config for the async save path — a stale closure would clobber
  // settings (e.g. title) edited while a save is in flight.
  const configRef = useRef(config);
  configRef.current = config;

  // Follow config.eventId: initial load, and settings changes re-point the
  // note at another chain (dropping any unsent edits to the old one).
  useEffect(() => {
    if (config.eventId && config.eventId === selfCaptured.current) return;
    selfCaptured.current = undefined;
    if (config.eventId !== eventId.current) {
      // Re-pointed in settings: drop unsent edits to the old chain.
      clearTimeout(timer.current);
      pending.current = null;
      eventId.current = config.eventId;
    }
    if (!config.eventId) {
      setText("");
      setStatus("idle");
      return;
    }
    const id = config.eventId;
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await api.events[":eventId"].$get({ param: { eventId: id } });
        if (cancelled) return;
        if (res.status === 200) {
          const row = await res.json();
          setText((row.data as { text?: string } | null)?.text ?? "");
          setStatus("idle");
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config.eventId]);

  // Unmount with an unsent edit: flush keepalive (only possible once the
  // note's event exists — a first-ever save can't persist its eventId after
  // unmount, so that narrow case is accepted as lost).
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null && eventId.current && !saving.current) {
        fetch(`/api/v1/events/${eventId.current}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            header: headerFor(pending.current),
            data: { text: pending.current },
          }),
        }).catch(() => {});
      }
    },
    [],
  );

  // Same serialized drain pattern as the dashboard autosave: one request in
  // flight, edits made mid-save coalesce into the next one.
  const runSave = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (pending.current !== null) {
        const value = pending.current;
        pending.current = null;
        setStatus("saving");
        try {
          if (!eventId.current) {
            const res = await api.events.$post({
              json: { header: headerFor(value), type: "note", data: { text: value } },
            });
            if (res.status !== 201) {
              setStatus("error");
              return;
            }
            const created = await res.json();
            eventId.current = created.eventId;
            selfCaptured.current = created.eventId;
            updateConfig({ ...configRef.current, eventId: created.eventId });
            setStatus("saved");
          } else {
            const res = await api.events[":eventId"].$patch({
              param: { eventId: eventId.current },
              json: { header: headerFor(value), data: { text: value } },
            });
            if (res.status === 200) {
              setStatus("saved");
            } else if (res.status === 409) {
              // Edited elsewhere and we lost the race: take the remote head.
              const head = await api.events[":eventId"].$get({
                param: { eventId: eventId.current },
              });
              if (head.status === 200) {
                const row = await head.json();
                setText((row.data as { text?: string } | null)?.text ?? "");
              }
              setStatus("stale");
            } else {
              setStatus("error");
              return;
            }
          }
        } catch {
          // Network blip: keep the newest unsaved text and retry shortly.
          pending.current ??= value;
          setStatus("error");
          timer.current = setTimeout(runSave, 3000);
          return;
        }
      }
    } finally {
      saving.current = false;
    }
  };

  const onChange = (value: string) => {
    setText(value);
    pending.current = value;
    setStatus("waiting");
    clearTimeout(timer.current);
    timer.current = setTimeout(runSave, SAVE_DEBOUNCE_MS);
  };

  const flush = () => {
    clearTimeout(timer.current);
    void runSave();
  };

  return (
    <Stack h="100%" gap={0} p="xs">
      <Textarea
        value={text}
        onChange={(e) => onChange(e.currentTarget.value)}
        onBlur={flush}
        placeholder="Write a note…"
        variant="unstyled"
        disabled={status === "loading"}
        styles={{
          root: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
          wrapper: { flex: 1, display: "flex", minHeight: 0 },
          input: { flex: 1, height: "100%", resize: "none" },
        }}
      />
      <Text c="dimmed" fz="xs" ta="right" mih="1.2em">
        {STATUS_LABEL[status]}
      </Text>
    </Stack>
  );
};

export default NoteView;
