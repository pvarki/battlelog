import { Badge, Container, Table, Text, Title } from "@mantine/core";
import { getRouteApi } from "@tanstack/react-router";

const route = getRouteApi("/events");

export const EventsPage = () => {
  const events = route.useLoaderData();

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
              <Table.Tr key={event.id}>
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
