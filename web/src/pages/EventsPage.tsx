import { Badge, Center, Container, Loader, Table, Text, Title } from "@mantine/core";
import { useLiveEvents } from "../live-events.ts";

export const EventsPage = () => {
  const events = useLiveEvents();

  if (!events) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Container size="xl" py="md">
      <Title order={2} mb="md">
        BattleLog
      </Title>
      {events.length === 0 ? (
        <Text c="dimmed">No events yet.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Header</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Created by</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {events.map((event) => (
              <Table.Tr key={event.eventId}>
                <Table.Td>{new Date(event.eventTime ?? event.createdAt).toLocaleString()}</Table.Td>
                <Table.Td>{event.header}</Table.Td>
                <Table.Td>
                  {event.type ? <Badge variant="light">{event.type}</Badge> : null}
                </Table.Td>
                <Table.Td>{event.createdBy}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
};
