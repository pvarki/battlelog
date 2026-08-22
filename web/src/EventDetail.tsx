import { Badge, Button, Code, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { EventResponse } from "./api.ts";
import { formatDateTime } from "./time.ts";

const Field = ({ label, children }: { label: string; children: ReactNode }) => {
  if (children == null || children === "") return null;
  return (
    <div>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      <Text fz="sm">{children}</Text>
    </div>
  );
};

export const EventDetail = ({
  event,
  onShowHistory,
}: {
  event: EventResponse;
  onShowHistory: () => void;
}) => (
  <Stack gap="sm">
    {event.type && (
      <Badge variant="light" style={{ alignSelf: "flex-start" }}>
        {event.type}
      </Badge>
    )}
    <Field label="Event time">{event.eventTime ? formatDateTime(event.eventTime) : null}</Field>
    <Field label="Logged">{formatDateTime(event.createdAt)}</Field>
    <Field label="Admiralty rating">
      {event.admiraltyReliability || event.admiraltyAccuracy
        ? `${event.admiraltyReliability ?? "–"}${event.admiraltyAccuracy ?? "–"} — source reliability ${event.admiraltyReliability ?? "not rated"}, information credibility ${event.admiraltyAccuracy ?? "not rated"}`
        : null}
    </Field>
    <Field label="Tags">{event.tags?.join(", ")}</Field>
    <Field label="HCoE domains">{event.hcoeDomains?.join(", ")}</Field>
    <Field label="Location">{event.location}</Field>
    <Field label="Coordinates">
      {event.locationPoint ? `${event.locationPoint.lat}, ${event.locationPoint.lng}` : null}
    </Field>
    <Field label="Source">{event.sourceUri}</Field>
    <Field label="By">{event.updatedBy ?? event.createdBy}</Field>
    {event.data != null && (
      <div>
        <Text fz="xs" c="dimmed">
          Data
        </Text>
        <Code block fz="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(event.data, null, 2)}
        </Code>
      </div>
    )}
    <Button variant="light" size="xs" style={{ alignSelf: "flex-start" }} onClick={onShowHistory}>
      Show all versions of this event
    </Button>
  </Stack>
);
