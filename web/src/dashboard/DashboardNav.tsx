import {
  ActionIcon,
  Box,
  CloseButton,
  Group,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Stack,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconFolder, IconSearch, IconStar, IconStarFilled } from "@tabler/icons-react";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { DashboardResponse } from "../api.ts";
import { Placeholder } from "../components/Placeholder.tsx";
import { useStoredSetting } from "../stored-setting.ts";
import { buildTree, type TreeNode } from "./tree.ts";
import { useDashboardManager } from "./useDashboardManager.tsx";

type Filter = "all" | "favorites";

const contains = (node: TreeNode, id: string | undefined): boolean =>
  node.kind === "item" ? node.id === id : node.children.some((c) => contains(c, id));

const splitPath = (name: string) => {
  const segments = name
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return { leaf: segments.pop() ?? name, folder: segments.join(" / ") };
};

export const DashboardNav = ({ dashboards }: { dashboards: DashboardResponse[] }) => {
  const { dashboardId } = useParams({ strict: false });
  const [query, setQuery] = useState("");
  const { newMenu, rowMenu, modals, errorText } = useDashboardManager(dashboards);
  const [filter, setFilter] = useStoredSetting<Filter>({
    key: "battlelog.nav-filter",
    defaultValue: "all",
  });
  // Per device on purpose: the shared folder structure is the team's, stars are yours.
  const [favorites, setFavorites] = useStoredSetting<string[]>({
    key: "battlelog.favorites",
    defaultValue: [],
  });

  const toggleFavorite = (id: string) =>
    setFavorites((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));

  const q = query.trim().toLowerCase();
  const views = dashboards.filter(
    (d) =>
      !d.isTemplate &&
      (filter === "all" || favorites.includes(d.id)) &&
      (!q || d.name.toLowerCase().includes(q)),
  );

  const byId = new Map(views.map((d) => [d.id, d]));

  const renderItem = (d: DashboardResponse, label: string, description?: string) => {
    const { id } = d;
    const favorite = favorites.includes(id);
    return (
      <Box key={id} className="nav-row">
        <NavLink
          label={label}
          description={description}
          active={id === dashboardId}
          py={4}
          pr={56}
          renderRoot={(props) => (
            <Link to="/d/$dashboardId" params={{ dashboardId: id }} {...props} />
          )}
        />
        <Group className="nav-actions" gap={2} wrap="nowrap">
          {rowMenu(d)}
          <ActionIcon
            className="nav-reveal"
            data-favorite={favorite || undefined}
            variant="subtle"
            color={favorite ? "warning" : "gray"}
            size="sm"
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() => toggleFavorite(id)}
          >
            {favorite ? <IconStarFilled size={14} /> : <IconStar size={14} />}
          </ActionIcon>
        </Group>
      </Box>
    );
  };

  const renderNode = (node: TreeNode) =>
    node.kind === "folder" ? (
      <NavLink
        key={node.path}
        label={node.name}
        leftSection={<IconFolder size={16} />}
        defaultOpened={contains(node, dashboardId)}
        childrenOffset="sm"
        py={4}
        renderRoot={(props) => <UnstyledButton {...props} />}
      >
        {node.children.map(renderNode)}
      </NavLink>
    ) : (
      renderItem(byId.get(node.id) as DashboardResponse, node.name)
    );

  const empty = q
    ? { title: "No matching views", detail: "No view name contains this search." }
    : filter === "favorites"
      ? { title: "No favorites", detail: "Star a view to pin it here." }
      : { title: "No views yet", detail: "Create one with the + button above." };

  return (
    <Stack gap="xs" h="100%" p="xs">
      <SegmentedControl
        size="xs"
        fullWidth
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        data={[
          { value: "all", label: "All" },
          { value: "favorites", label: "Favorites" },
        ]}
      />
      <Group gap="xs" wrap="nowrap">
        {newMenu}
        <TextInput
          flex={1}
          size="xs"
          placeholder="Search"
          aria-label="Search views"
          leftSection={<IconSearch size={14} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          rightSection={
            query && (
              <CloseButton size="xs" aria-label="Clear search" onClick={() => setQuery("")} />
            )
          }
        />
      </Group>
      {errorText}
      <ScrollArea flex={1}>
        {views.length === 0 ? (
          <Placeholder {...empty} />
        ) : q || filter === "favorites" ? (
          // Flat, with the folder path as a subtitle: a search match deep in a
          // collapsed folder would be invisible, and favorites are a shortlist.
          views
            .map((d) => ({ d, ...splitPath(d.name) }))
            .sort((a, b) => a.leaf.localeCompare(b.leaf, undefined, { numeric: true }))
            .map((v) => renderItem(v.d, v.leaf, v.folder || undefined))
        ) : (
          buildTree(views).map(renderNode)
        )}
      </ScrollArea>
      {modals}
    </Stack>
  );
};
