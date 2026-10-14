import { Pill } from "@mantine/core";
import { getRouteApi } from "@tanstack/react-router";
import type { EventResponse } from "../../api.ts";
import { linkOfEvent } from "../../tak/links.ts";

const dashboardRoute = getRouteApi("/d/$dashboardId");

/** Shows which map selection a widget follows, and lets go of it. */
export const TakSelectionPill = ({
  uid,
  events,
}: {
  uid: string;
  events: EventResponse[] | null;
}) => {
  const navigate = dashboardRoute.useNavigate();
  const callsign = events?.map(linkOfEvent).find((link) => link?.callsign)?.callsign;
  return (
    <Pill
      withRemoveButton
      removeButtonProps={{ "aria-label": "Clear the map selection" }}
      onRemove={() => navigate({ search: (prev) => ({ ...prev, tak: undefined }), replace: true })}
      mb={4}
    >
      Linked to {callsign ?? uid}
    </Pill>
  );
};
