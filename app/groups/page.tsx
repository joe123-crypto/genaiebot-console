import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { LiveGroups } from "./_components/live-groups";
import { getLiveView } from "@/src/lib/live-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { parseGroupFilter, groupFilterQuery } from "@/src/domains/group-filter";
import { WRITES_ENABLED } from "@/src/config";
import type { LivePage, Group } from "@/src/lib/live-types";
export const dynamic = "force-dynamic";
export default async function GroupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = parseGroupFilter(await searchParams);
  let initial: LivePage<Group> | null = null;
  let initialError: string | undefined;
  try { initial = await getLiveView("groups", groupFilterQuery(filter)); }
  catch (error) { if (!(error instanceof BotUnavailableError)) throw error; initialError = error.detail; }
  return <Shell live><PageHead title="Groups" subtitle="Live observations and campaign assignments." />
    <LiveGroups initial={initial} initialError={initialError} filter={filter} writable={WRITES_ENABLED} /></Shell>;
}
