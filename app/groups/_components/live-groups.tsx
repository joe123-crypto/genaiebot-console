"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GroupsTable, type GroupEditing } from "./groups-table";
import { useDisplayTimezone } from "@/app/_components/timezone-context";
import { DiscoveredGroups } from "./discovered-groups";
import { DEFAULT_GROUP_FILTER, groupFilterQuery, type GroupFilter } from "@/src/domains/group-filter";
import { GROUP_EDIT_FIELDS } from "@/src/domains/group-edit";
import { canAct, canDelete, canWrite } from "@/src/lib/write-capabilities";
import type { DiscoveredGroup, Group, GroupMetrics } from "@/src/lib/types";
import type { LiveMetrics, LivePage } from "@/src/lib/live-types";
import { SyncNotice, useLivePage } from "@/app/_components/live-page";
import { liveFetch, LoadMore, useDebounced, useLivePoll, useVisibleIds } from "@/app/_components/use-live";

export function LiveGroups({ initial, initialError, filter: initialFilter, writable }: {
  initial: LivePage<Group> | null; initialError?: string; filter: GroupFilter; writable: boolean;
}) {
  const displayZone = useDisplayTimezone();
  const root = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState(initialFilter);
  const q = useDebounced(filter.q, 300);
  const query = groupFilterQuery({ ...filter, q }).toString();
  const groups = useLivePage("groups", initial, query, row => row.jid, root, initialError);
  const discovery = useLivePage<DiscoveredGroup>("discoveries", null, "", row => row.jid, root);
  const ids = useVisibleIds(root, [...groups.rows, ...discovery.rows].map(row => row.jid).join(","));
  const [metrics, setMetrics] = useState<Record<string, GroupMetrics>>({});
  const idsKey = ids.sort().join(",");
  const readMetrics = useCallback(async (signal?: AbortSignal) => {
    if (!idsKey) return;
    try {
      const data = await liveFetch<LiveMetrics>("metrics", new URLSearchParams({ ids: idsKey }), signal);
      if (!signal?.aborted) setMetrics(previous => ({ ...previous, ...Object.fromEntries(data.rows.map(row => [row.jid, row.metrics])) }));
    } catch { /* Keep the last observation, including its timestamp. */ }
  }, [idsKey]);
  useEffect(() => { const controller = new AbortController(); void readMetrics(controller.signal); return () => controller.abort(); }, [readMetrics]);
  useLivePoll(readMetrics);
  const context = groups.page?.context;
  const accepted = new Set(context?.writes?.fields.groups ?? []);
  const editing: GroupEditing = {
    edit: canWrite(writable, context?.writes, "groups"), delete: canDelete(writable, context?.writes, "groups"),
    editableFields: GROUP_EDIT_FIELDS.filter(field => accepted.has(field)),
    leave: canAct(writable, context?.actions, "leaveGroup"), clearRecords: canAct(writable, context?.actions, "clearRecords"),
    lines: context?.accounts.map(line => line.id) ?? [], tiers: groups.page?.facets?.tiers ?? ["busy", "normal", "quiet"],
  };
  return <div ref={root}>
    <SyncNotice sync={groups.page?.sync} error={groups.error} />
    <SyncNotice sync={discovery.page?.sync} error={discovery.error} />
    <DiscoveredGroups groups={discovery.rows.map(row => ({ ...row, metrics: metrics[row.jid] ?? row.metrics }))}
      zone={displayZone} discovery={discovery.page?.discovery} addGate={writable ? canWrite(writable, context?.writes, "groups", "name", "source", "status", "promos", "daily_cap") : undefined} />
    <LoadMore next={discovery.page?.nextCursor} loading={discovery.loading} load={discovery.loadMore} />
    <GroupsTable groups={groups.rows.map(row => ({ ...row, metrics: metrics[row.jid] ?? row.metrics }))}
      disabledPromos={groups.page?.disabledPromos ?? []} writesEnabled={writable} editing={editing}
      campaigns={groups.page?.facets?.campaigns ?? []} campaignGate={canWrite(writable, context?.writes, "groups", "promos")}
      initialFilter={initialFilter ?? DEFAULT_GROUP_FILTER} remote={{ onFilter: setFilter, total: groups.page?.total ?? 0,
        lines: groups.page?.facets?.lines ?? [], campaigns: groups.page?.facets?.campaigns ?? [], tiers: editing.tiers }} />
    <LoadMore next={groups.page?.nextCursor} loading={groups.loading} load={groups.loadMore} />
  </div>;
}
