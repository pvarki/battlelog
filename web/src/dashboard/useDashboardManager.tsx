import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  FileButton,
  Group,
  Menu,
  Modal,
  Paper,
  Radio,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconClipboardCopy,
  IconCopy,
  IconDots,
  IconDownload,
  IconFileImport,
  IconPencil,
  IconPlus,
  IconSearch,
  IconStar,
  IconTrash,
} from "@tabler/icons-react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, useTransition } from "react";
import type { DashboardResponse } from "../api.ts";
import { api, dashboardsApi } from "../api.ts";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Placeholder } from "../components/Placeholder.tsx";
import { formatDateTime } from "../time.ts";
import { LayoutThumbnail } from "./LayoutThumbnail.tsx";
import {
  exportFilename,
  forkWidgets,
  parseDashboardImport,
  templateEventFor,
  toExportJson,
  widgetEventPointers,
} from "./transfer.ts";

/** Matches the server's cap, so the field can't compose a body the API rejects. */
const DESCRIPTION_MAX = 280;

const widgetCount = (n: number) => `${n} widget${n === 1 ? "" : "s"}`;

// Above this many templates, eyeballing the list stops working and it gets a
// search box. Below it, the box is one more thing to read for no gain.
const SEARCH_FROM = 6;

// Roughly four cards; past that the list scrolls instead of the dialog.
const TEMPLATE_LIST_MAX_H = 220;

const matchesQuery = (d: DashboardResponse, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return (
    !q || d.name.toLowerCase().includes(q) || (d.description?.toLowerCase().includes(q) ?? false)
  );
};

/**
 * What the details modal is currently for. Every one of the four asks for a name
 * and a description; only the submit differs. `edit` and `saveTemplate` hold an
 * id rather than the row so submit reads the version the list currently has — a
 * retry after a 409 would otherwise resend the stale one forever.
 */
type DetailsTarget =
  | { kind: "new" }
  | { kind: "fromTemplate" }
  | { kind: "saveTemplate"; id: string }
  | { kind: "edit"; id: string }
  | null;

const DETAILS_TITLE: Record<NonNullable<DetailsTarget>["kind"], string> = {
  new: "New view",
  fromTemplate: "New view from template",
  saveTemplate: "Save as template",
  edit: "Name & description",
};

const DETAILS_NAME_HINT: Record<NonNullable<DetailsTarget>["kind"], string | undefined> = {
  new: undefined,
  fromTemplate: "Yours to choose — it does not have to match the template.",
  saveTemplate:
    "Template names must be unique; they are how a deployed template is matched on restart.",
  edit: undefined,
};

// Switching template re-suggests its name, but never overwrites one the user
// typed: "untouched" means the field still holds what the previous pick put there.
const suggested = (current: string, previous: string, next: string) =>
  !current.trim() || current === previous ? next : current;

/**
 * Create, rename, duplicate, export, import and delete — everything that
 * manages the dashboard list, as pieces the side panel places: the New menu,
 * a per-row menu, and the dialogs those open (render `modals` once).
 */
export const useDashboardManager = (all: DashboardResponse[]) => {
  const navigate = useNavigate();
  const router = useRouter();
  const [creating, startCreate] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<DetailsTarget>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateQuery, setTemplateQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DashboardResponse | null>(null);

  const templates = all.filter((d) => d.isTemplate);
  const shownTemplates = templates.filter((t) => matchesQuery(t, templateQuery));
  const searchable = templates.length > SEARCH_FROM;

  // Navigation alone keeps the root loader's list: the side panel only refetches when invalidated.
  const openCreated = async (dashboardId: string) => {
    await router.invalidate();
    await navigate({ to: "/d/$dashboardId", params: { dashboardId } });
  };

  // Creating a dashboard leaves this page, so a failure has to keep the modal
  // open with the field the user can fix — a thrown error would hand a name
  // collision to the route error boundary, which is not a fixable screen.
  const create = (json: {
    name: string;
    description: string | null;
    isTemplate?: boolean;
    widgets: DashboardResponse["widgets"];
    templateEvents?: DashboardResponse["templateEvents"];
  }) =>
    startCreate(async () => {
      const res = await dashboardsApi.dashboards.$post({ json });
      if (res.status === 409) {
        setError((await res.json()).error);
        return;
      }
      if (!res.ok) {
        setError(`Couldn't create it (${res.status}) — try again`);
        return;
      }
      const created = await res.json();
      setTarget(null);
      // A template is a shelf item, not somewhere to go: stay on the list.
      if (json.isTemplate) {
        await router.invalidate();
        return;
      }
      await openCreated(created.id);
    });

  // All list mutations funnel through here: surface failures (a silent no-op
  // delete reads as "the app is broken") and block double-clicks while one
  // is in flight. Reload the list either way — after a failure too, so a
  // retry works from the version the server actually holds.
  const mutate = async (label: string, fn: () => Promise<{ ok: boolean }>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(label);
      setError(null);
    } catch {
      setError(`${label} failed — try again`);
    } finally {
      await router.invalidate();
      setBusy(false);
    }
  };

  const open = (next: DetailsTarget, name: string, description: string | null) => {
    setForm({ name, description: description ?? "" });
    setError(null);
    setTarget(next);
  };

  const openNew = () => {
    setTemplateId(null);
    open({ kind: "new" }, "", null);
  };

  // Pre-picks the first template, so the common single-template case is one
  // click from an editable name instead of two.
  const openFromTemplate = () => {
    const first = templates[0];
    if (!first) return;
    setTemplateQuery("");
    setTemplateId(first.id);
    open({ kind: "fromTemplate" }, first.name, first.description);
  };

  // Naming the template here is the point: reusing the dashboard's name is what
  // made a second save collide with the first and report an unfixable failure.
  const openSaveTemplate = (d: DashboardResponse) =>
    open({ kind: "saveTemplate", id: d.id }, d.name, d.description);

  const pickTemplate = (id: string) => {
    const next = templates.find((t) => t.id === id);
    const previous = templates.find((t) => t.id === templateId);
    setTemplateId(id);
    if (!next) return;
    setForm((f) => ({
      name: suggested(f.name, previous?.name ?? "", next.name),
      description: suggested(f.description, previous?.description ?? "", next.description ?? ""),
    }));
  };

  const openEdit = (d: DashboardResponse) =>
    open({ kind: "edit", id: d.id }, d.name, d.description);

  const submitDetails = () => {
    const name = form.name.trim();
    if (!name) return;
    // One truth for "no description": null. An empty string would render the
    // same but make every reader test two cases.
    const description = form.description.trim() || null;
    if (!target) return;
    if (target.kind === "new") {
      create({ name, description, widgets: [] });
      return;
    }
    if (target.kind === "fromTemplate") {
      // A copy used to inherit the template's name verbatim, which put two
      // identically named rows in the list with no way to tell them apart.
      const template = templates.find((t) => t.id === templateId);
      if (!template) return;
      create({
        name,
        description,
        // Documents come only from the snapshots; a pointer left in the
        // template's widgets would make the copy write into the template's.
        widgets: forkWidgets(template.widgets),
        templateEvents: template.templateEvents,
      });
      return;
    }
    const current = all.find((d) => d.id === target.id);
    if (!current) return;
    if (target.kind === "saveTemplate") {
      create({
        name,
        description,
        isTemplate: true,
        // Without this every dashboard made from the template would write into
        // the *source* board's notes and checklists, not its own.
        widgets: forkWidgets(current.widgets),
      });
      return;
    }
    void mutate("Save", async () => {
      const res = await dashboardsApi.dashboards[":dashboardId"].$patch({
        param: { dashboardId: current.id },
        json: { version: current.version, name, description },
      });
      if (res.ok) setTarget(null);
      return res;
    });
  };

  const remove = (d: DashboardResponse) =>
    void mutate("Delete", () =>
      dashboardsApi.dashboards[":dashboardId"].$delete({ param: { dashboardId: d.id } }),
    );

  const duplicate = (source: DashboardResponse) =>
    mutate("Duplicate", () =>
      dashboardsApi.dashboards.$post({
        json: {
          name: `${source.name} (copy)`,
          description: source.description,
          widgets: source.widgets,
        },
      }),
    );

  const download = (d: DashboardResponse) => {
    const url = URL.createObjectURL(new Blob([toExportJson(d)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(d.name);
    a.click();
    // Revoking in the same tick can cancel the download before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportJsonWithCurrentDocuments = async (d: DashboardResponse): Promise<string> => {
    const pointers = widgetEventPointers(d.widgets);
    if (pointers.length === 0) return toExportJson(d);

    const templateEvents = await Promise.all(
      pointers.map(async (pointer) => {
        const res = await api.events[":eventId"].$get({ param: { eventId: pointer.eventId } });
        if (!res.ok) throw new Error(`event ${pointer.eventId}`);
        return templateEventFor(pointer, await res.json());
      }),
    );
    return toExportJson({ ...d, templateEvents });
  };

  // navigator.clipboard rejects outside a secure context — say so rather than
  // letting the menu item look like it did nothing.
  const copy = async (d: DashboardResponse) => {
    let json: string;
    try {
      json = await exportJsonWithCurrentDocuments(d);
    } catch {
      notifications.show({
        color: "danger",
        message: "Couldn't copy JSON — one of the widget documents could not be loaded",
      });
      return;
    }

    navigator.clipboard.writeText(json).then(
      () =>
        notifications.show({ color: "success", message: `Copied “${d.name}” JSON to clipboard` }),
      () =>
        notifications.show({
          color: "danger",
          message: "Clipboard unavailable — use Download JSON instead",
        }),
    );
  };

  // Own error state (not `mutate`'s): a rejected file is expected input here,
  // and the message belongs next to the textarea the user can fix.
  const runImport = () => {
    const parsed = parseDashboardImport(importText);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    setImportError(null);
    startCreate(async () => {
      const res = await dashboardsApi.dashboards.$post({ json: parsed.value });
      if (!res.ok) {
        setImportError(`Rejected by the server (${res.status}) — not a valid view export`);
        return;
      }
      const created = await res.json();
      setImportOpen(false);
      setImportText("");
      await openCreated(created.id);
    });
  };

  const rowMenu = (d: DashboardResponse) => (
    <Menu position="bottom-end" shadow="md">
      <Menu.Target>
        <ActionIcon
          className="nav-reveal"
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`Actions for ${d.name}`}
          title="Actions"
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {!d.isTemplate && (
          <>
            {/* Templates are keyed by name for seeding, so renaming one would
                let the next boot re-seed it as a second template. */}
            <Menu.Item
              leftSection={<IconPencil size={14} />}
              disabled={busy}
              onClick={() => openEdit(d)}
            >
              Name & description…
            </Menu.Item>
            <Menu.Item
              leftSection={<IconStar size={14} />}
              disabled={busy}
              onClick={() => openSaveTemplate(d)}
            >
              Save as template…
            </Menu.Item>
            <Menu.Item
              leftSection={<IconCopy size={14} />}
              disabled={busy}
              onClick={() => duplicate(d)}
            >
              Duplicate
            </Menu.Item>
          </>
        )}
        {d.isTemplate && (
          <Menu.Item
            leftSection={<IconPencil size={14} />}
            onClick={() =>
              navigate({
                to: "/d/$dashboardId",
                params: { dashboardId: d.id },
              })
            }
          >
            Edit template
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => download(d)}>
          Download JSON
        </Menu.Item>
        <Menu.Item leftSection={<IconClipboardCopy size={14} />} onClick={() => copy(d)}>
          Copy JSON
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          color="danger"
          leftSection={<IconTrash size={14} />}
          disabled={busy}
          onClick={() => setPendingDelete(d)}
        >
          Delete{d.isTemplate ? " template" : ""}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  const row = (d: DashboardResponse) => (
    <Paper key={d.id} withBorder p="sm">
      <Group wrap="nowrap" align="center" gap="sm">
        <LayoutThumbnail widgets={d.widgets} />
        <RowInfo dashboard={d} />
        {rowMenu(d)}
      </Group>
    </Paper>
  );

  const newMenu = (
    // A template is a starting point, not a place you can go — so it belongs
    // in the create control, not in a list beside the real dashboards.
    <Menu position="bottom-start" shadow="md">
      <Menu.Target>
        <ActionIcon
          variant="default"
          size="input-xs"
          aria-label="New view"
          title="New view"
          loading={creating}
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={openNew}>Empty view…</Menu.Item>
        {/* One item rather than the template list inline: the picker has
                    room to say what each template contains, and the menu stops
                    growing with the number of them. */}
        {templates.length > 0 && <Menu.Item onClick={openFromTemplate}>From template…</Menu.Item>}
        <Menu.Divider />
        <Menu.Item leftSection={<IconFileImport size={14} />} onClick={() => setImportOpen(true)}>
          Import from JSON…
        </Menu.Item>
        {templates.length > 0 && (
          <Menu.Item
            leftSection={<IconStar size={14} />}
            onClick={() => {
              setTemplateQuery("");
              setTemplatesOpen(true);
            }}
          >
            Manage templates…
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );

  const errorText = error && !target && (
    <Text c="danger.4" fz="xs" role="status">
      {error}
    </Text>
  );

  const modals = (
    <>
      <Modal
        opened={target !== null}
        onClose={() => setTarget(null)}
        title={target ? DETAILS_TITLE[target.kind] : ""}
      >
        <Stack>
          {target?.kind === "fromTemplate" && (
            <Radio.Group
              value={templateId ?? ""}
              onChange={pickTemplate}
              label="Template"
              description="Copies its widgets and layout. Editing the copy never changes the template."
            >
              {searchable && (
                <TextInput
                  mt="xs"
                  placeholder="Search templates"
                  leftSection={<IconSearch size={16} />}
                  value={templateQuery}
                  onChange={(e) => setTemplateQuery(e.currentTarget.value)}
                />
              )}
              {/* Bounded, so the name field and Create button stay put however
                  many templates there are — the modal caps at the viewport, and
                  six cards used to be enough to push the button below the fold. */}
              <Box mah={TEMPLATE_LIST_MAX_H} mt="xs" style={{ overflowY: "auto" }}>
                <Stack gap="xs">
                  {shownTemplates.map((t) => (
                    <Radio.Card key={t.id} value={t.id} p="xs" withBorder>
                      <Group wrap="nowrap" align="center" gap="sm">
                        <Radio.Indicator />
                        <LayoutThumbnail widgets={t.widgets} />
                        <Box mih={0} style={{ flex: 1 }}>
                          <Text fz="sm" fw={500} truncate>
                            {t.name}
                          </Text>
                          <Text fz="xs" c="dimmed" lineClamp={1}>
                            {t.description
                              ? `${widgetCount(t.widgets.length)} · ${t.description}`
                              : widgetCount(t.widgets.length)}
                          </Text>
                        </Box>
                      </Group>
                    </Radio.Card>
                  ))}
                  {shownTemplates.length === 0 && (
                    <Placeholder
                      title="No matching template"
                      detail={`No template name or description contains “${templateQuery}”.`}
                    />
                  )}
                </Stack>
              </Box>
            </Radio.Group>
          )}
          <TextInput
            label="Name"
            description={DETAILS_NAME_HINT[target?.kind ?? "new"]}
            data-autofocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            onKeyDown={(e) => e.key === "Enter" && submitDetails()}
            maxLength={100}
          />
          <Textarea
            label="Description"
            description="Shown in the views list — what this view is for, so near-identical names stay apart."
            autosize
            minRows={2}
            maxRows={5}
            maxLength={DESCRIPTION_MAX}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
          />
          {error && (
            <Text c="danger.4" fz="sm" role="status">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button
              onClick={submitDetails}
              loading={creating || busy}
              disabled={!form.name.trim() || (target?.kind === "fromTemplate" && !templateId)}
            >
              {target?.kind === "edit" ? "Save" : "Create"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        title="Templates"
        size="lg"
      >
        <Stack gap="xs">
          <Text c="dimmed" fz="sm">
            A template is a starting point, not a view. Pick one under New to make a copy — editing
            that copy never changes the template. Templates deployed with the server are restored on
            restart.
          </Text>
          {searchable && (
            <TextInput
              placeholder="Search templates"
              leftSection={<IconSearch size={16} />}
              value={templateQuery}
              onChange={(e) => setTemplateQuery(e.currentTarget.value)}
            />
          )}
          {shownTemplates.map(row)}
          {shownTemplates.length === 0 && (
            <Placeholder
              title="No matching template"
              detail={`No template name or description contains “${templateQuery}”.`}
            />
          )}
        </Stack>
      </Modal>

      <Modal opened={importOpen} onClose={() => setImportOpen(false)} title="Import view" size="lg">
        <Stack>
          <Text c="dimmed" fz="sm">
            Layout and widget settings are restored. Contents that live in the event log don't
            travel with the file — those widgets arrive empty and start a fresh chain on first edit.
          </Text>
          <Group>
            <FileButton
              accept="application/json,.json"
              onChange={async (file) => {
                if (!file) return;
                setImportError(null);
                setImportText(await file.text());
              }}
            >
              {(props) => (
                <Button variant="default" {...props}>
                  Choose file…
                </Button>
              )}
            </FileButton>
          </Group>
          <Textarea
            label="or paste exported JSON"
            autosize
            minRows={6}
            maxRows={16}
            value={importText}
            onChange={(e) => setImportText(e.currentTarget.value)}
          />
          {importError && (
            <Text c="danger.4" fz="sm" role="status">
              {importError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button onClick={runImport} loading={creating} disabled={!importText.trim()}>
              Import
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ConfirmDialog
        opened={pendingDelete !== null}
        title={`Delete ${pendingDelete?.isTemplate ? "template" : "view"} "${pendingDelete?.name}"?`}
        confirmLabel="Delete"
        onConfirm={() => pendingDelete && remove(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      >
        This cannot be undone.
      </ConfirmDialog>
    </>
  );

  return { newMenu, rowMenu, modals, errorText };
};

const RowInfo = ({ dashboard }: { dashboard: DashboardResponse }) => (
  <Box mih={0} style={{ flex: 1 }}>
    {dashboard.isTemplate ? (
      <Text>{dashboard.name}</Text>
    ) : (
      <Anchor
        renderRoot={(props) => (
          <Link to="/d/$dashboardId" params={{ dashboardId: dashboard.id }} {...props} />
        )}
      >
        {dashboard.name}
      </Anchor>
    )}
    {dashboard.description && (
      <Text fz="xs" lineClamp={2} title={dashboard.description}>
        {dashboard.description}
      </Text>
    )}
    <Text c="dimmed" fz="xs">
      {widgetCount(dashboard.widgets.length)} · updated {formatDateTime(dashboard.updatedAt)}
    </Text>
  </Box>
);
