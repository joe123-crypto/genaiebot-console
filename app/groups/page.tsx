import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead } from "@/app/_components/ui";
import { BotUnavailableError, getGroups } from "@/src/lib/bot-client";
import { isAdvertising, parseGroupFilter } from "@/src/domains/console";
import { plural } from "@/src/lib/format";
import { WRITES_ENABLED } from "@/src/config";
import { GroupsTable } from "@/app/groups/_components/groups-table";
import type { Group } from "@/src/lib/types";

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
  try {
    ({ groups, disabledPromos } = await getGroups());
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return (
      <Shell>
        <PageHead title="Groups" />
        <BotError detail={error.detail} />
      </Shell>
    );
  }

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
      <GroupsTable
        groups={groups}
        disabledPromos={disabledPromos}
        writesEnabled={WRITES_ENABLED}
        initialFilter={initialFilter}
      />
    </Shell>
  );
}
