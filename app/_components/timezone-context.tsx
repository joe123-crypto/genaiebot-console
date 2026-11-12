"use client";

import { createContext, useContext, type ReactNode } from "react";
import { BOT_TIMEZONE } from "@/src/config";

/**
 * The one piece of state every screen reads and none of them owns.
 *
 * The console threads its data through props, and that is still right for
 * anything the bot sent. The display clock is different: it belongs to no
 * payload, changes nothing a page asks for, and is wanted by leaves five levels
 * down in five sections. Passing it by hand would put a timezone prop on
 * components that have no other reason to know about time.
 *
 * It is read-only. Choosing a zone sets a cookie and re-renders from the server,
 * so there is nothing here to update.
 */
const DisplayTimezoneContext = createContext<string>(BOT_TIMEZONE);

export function TimezoneProvider({ zone, children }: { zone: string; children: ReactNode }) {
  return <DisplayTimezoneContext.Provider value={zone}>{children}</DisplayTimezoneContext.Provider>;
}

export function useDisplayTimezone() {
  return useContext(DisplayTimezoneContext);
}
