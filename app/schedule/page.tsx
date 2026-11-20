import { requireOperator } from "@/src/lib/auth";
import { redirect } from "next/navigation";
export default async function SchedulePage() {
  await requireOperator();
  redirect("/");
}
