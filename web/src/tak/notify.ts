import { notifications } from "@mantine/notifications";

export const notifyFailure = (title: string) => (err: unknown) =>
  notifications.show({
    color: "danger",
    title,
    message: err instanceof Error ? err.message : String(err),
  });
