"use client";
import { useEffect, useState } from "react";
/** Resource-level polling owns data requests. The shell never reloads a page. */
export function AutoRefresh() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const update = () => setPaused(document.visibilityState !== "visible" || !navigator.onLine);
    update(); document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return <span className="console-refresh" role="status">{paused ? "Updates paused" : "Live updates · 30s"}</span>;
}
