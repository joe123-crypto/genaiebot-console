import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead } from "@/app/_components/ui";
import { BotUnavailableError, getGroups } from "@/src/lib/bot-client";
import { isAdvertising, loadOverview, parseGroupFilter } from "@/src/domains/console";
import { GROUP_EDIT_FIELDS } from "@/src/domains/group-edit";
import { canDelete, canWrite } from "@/src/lib/write-capabilities";
import { plural } from "@/src/lib/format";
import { WRITES_ENABLED } from "@/src/config";
import { GroupsTable, type GroupEditing } from "@/app/groups/_components/groups-table";
import { DiscoveredGroups } from "@/app/groups/_components/discovered-groups";
import type { Group, DiscoveredGroup, GroupDiscovery, Overview } from "@/src/lib/types";

const TIERS_FALLBACK = ["busy", "normal", "quiet"];

/** What the row actions may do, from the console's switch and the bot's own
 *  report of what it accepts. Without an overview nothing is armed. */
function groupEditing(overview: Overview | undefined): GroupEditing {
  const writes = overview?.writes;
  const accepted = new Set(writes?.fields.groups ?? []);
  return {
    edit: canWrite(WRITES_ENABLED, writes, "groups"),
    editableFields: GROUP_EDIT_FIELDS.filter((field) => accepted.has(field)),
    delete: canDelete(WRITES_ENABLED, writes, "groups"),
    lines: (overview?.accounts ?? []).map((line) => line.id),
    tiers: overview?.capSettings ? Object.keys(overview.capSettings.bands) : TIERS_FALLBACK,
  };
}

export const dynamic = "force-dynamic";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Awaited before the read, so the error path below is untouched by it.
  const initialFilter = parseGroupFilter(await searchParams);

  let groups: Group[];
  let disabledPromos: string[];
  let discoveredGroups: DiscoveredGroup[] | undefined;
  let groupDiscovery: GroupDiscovery | undefined;
  try {
    ({ groups, disabledPromos, discoveredGroups, groupDiscovery } = await getGroups());
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return (
      <Shell>
        <PageHead title="Groups" />
        <BotError detail={error.detail} />
      </Shell>
    );
  }

  // Already read for this request by the layout, so this costs nothing.
  const loaded = await loadOverview();
  const overview = loaded.ok ? loaded.overview : undefined;
  const editing = groupEditing(overview);
  // Adding writes a whole new record, so every field it sets must be accepted.
  const addGate = WRITES_ENABLED
    ? canWrite(WRITES_ENABLED, overview?.writes, "groups",
               "name", "source", "status", "promos", "daily_cap")
    : undefined;

  return (
    <Shell>
      {/* The record, not the filtered view: how many groups there are does not
          change because someone searched. The table reports its own count. */}
      <PageHead
        title="Groups"
        subtitle={`${plural(groups.length, "group")} on record · ${plural(
          groups.filter(isAdvertising).length,
          "advertising",
        )}`}
      />
      <DiscoveredGroups groups={discoveredGroups} discovery={groupDiscovery} addGate={addGate} />
      <GroupsTable
        groups={groups}
        disabledPromos={disabledPromos}
        writesEnabled={WRITES_ENABLED}
        editing={editing}
        initialFilter={initialFilter}
      />
    </Shell>
  );
}
