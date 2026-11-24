import { getOperator } from "@/src/lib/auth";
import { safeReturnTo } from "@/src/lib/auth-types";
import { redirect } from "next/navigation";
import { LoginForm } from "./sign-in";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  let unavailable = false;
  let operator;
  try { operator = await getOperator(); } catch { unavailable = true; }
  if (operator) redirect(returnTo);
  return <main className="login-page"><div className="login-aurora" aria-hidden="true">
    <span className="login-aurora-sky" />
    <span className="login-aurora-glow" />
    <span className="login-aurora-ember" />
    <span className="login-aurora-drift" />
    <span className="login-aurora-grain" />
  </div><section className="login-card" aria-labelledby="login-title">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/logo.png" alt="" width="44" height="100" />
    <span className="login-brand">Genaie</span>
    <h1 id="login-title">Sign in to your console</h1>
    <p>Manage your groups, campaigns and WhatsApp lines.</p>
    <LoginForm returnTo={returnTo} unavailable={unavailable} />
  </section></main>;
}
