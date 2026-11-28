import type { ReactNode } from "react";
import Link from "next/link";
import { requireOperator } from "@/src/lib/auth";
import { hasBot, requireWorkspace } from "@/src/lib/workspace";
import { signUpDate } from "@/src/lib/account-profile";
import { botRemovalOf } from "@/src/lib/bot-teardown";
import { displayTimezone } from "@/src/lib/display-timezone";
import { avatarInitial } from "@/src/lib/format";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead, Section } from "@/app/_components/ui";
import { SettingsGroup } from "@/app/_components/settings-group";
import { DeleteAccountCard } from "@/app/_components/delete-account-card";
import { SignOut } from "@/app/_components/sign-out";

export const dynamic = "force-dynamic";

const SUBTITLE = "Who you are signed in as, and the workspace your groups, campaigns and lines belong to.";

const PROFILE_NOTE = "Your name and address come from the Google account you sign in with, so they change there rather than here.";
const WORKSPACE_NOTE = "Everything you do in the console belongs to one workspace, and only you can see inside it.";
const SESSION_NOTE = "This browser's sign-in. Signing out here leaves your other devices signed in.";
const CLOSING_NOTE = "Your workspace and everything in it go together, and this is the one thing here that cannot be undone.";

/** A date the way a person says it, on the clock this browser is reading. */
function Day({ at, zone }: { at: string | null; zone: string }) {
  if (!at) return <>Not recorded</>;
  return (
    <time dateTime={at}>
      {new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: zone }).format(new Date(at))}
    </time>
  );
}

/** One fact: what it is on the left, what it says on the right. The shape is
 *  the Settings card's own row, so the two screens are read the same way. */
function Fact({ name, hint, children }: { name: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <h3 className="setting-name">{name}</h3>
        {hint ? <span className="setting-hint">{hint}</span> : null}
      </div>
      <div className="setting-control"><span className="account-fact-value">{children}</span></div>
    </div>
  );
}

/**
 * The screen about the person rather than about their adverts: who the console
 * knows them as, when they signed up, which workspace that put them in, and
 * the two things they can do about it all -- sign out, or leave for good.
 *
 * It asks the bot nothing. Every value here comes from the session and the
 * workspace registry, so it renders the same for someone who never set a bot
 * up as for someone whose bot is down.
 */
export default async function AccountPage() {
  const operator = await requireOperator();
  const workspace = await requireWorkspace();
  const botRemoval = await botRemovalOf(workspace);
  const zone = await displayTimezone();
  // The registry has the date for everyone who signed up after it began
  // writing one, and it is already in hand. Auth is asked only for the few
  // workspaces registered before that, and is never allowed to fail the page.
  const signedUp = workspace.createdAt ?? await signUpDate(operator.uid);

  const connected = hasBot(workspace);
  const skipped = workspace.onboarding === "skipped";

  return (
    <Shell>
      <PageHead title="Account" subtitle={SUBTITLE} />

      <div className="settings-page">
        <section className="account-hero" aria-label="Signed in as">
          <span className="account-hero-avatar" aria-hidden>{avatarInitial(operator.name)}</span>
          <div className="account-hero-who">
            <h2 className="account-hero-name">{operator.name}</h2>
            <span className="account-hero-email">{operator.email}</span>
            <span className="account-hero-meta">
              <span className="pill pill-info">Google</span>
              {signedUp ? <span>Member since <Day at={signedUp} zone={zone} /></span> : null}
            </span>
          </div>
        </section>

        <SettingsGroup id="profile" title="Profile" description={PROFILE_NOTE}>
          <Section className="settings-card">
            <Fact name="Name">{operator.name}</Fact>
            <Fact name="Email address">{operator.email}</Fact>
            <Fact name="Signed in with" hint="The console offers no other way in, and holds no password of its own.">
              Google
            </Fact>
            <Fact
              name="Signed up"
              hint={signedUp
                ? "The day your Google sign-in made this workspace."
                : "This workspace was registered before the console wrote the date down."}
            >
              <Day at={signedUp} zone={zone} />
            </Fact>
          </Section>
        </SettingsGroup>

        <SettingsGroup id="workspace" title="Workspace" description={WORKSPACE_NOTE}>
          <Section className="settings-card">
            <Fact name="Name">{workspace.name}</Fact>
            <Fact name="Workspace ID" hint="Share this with whoever sets up your bot, and quote it when you report a problem.">
              <span className="account-fact-ref">{workspace.id}</span>
            </Fact>
            <Fact
              name="Bot"
              hint={!connected
                ? "Your groups, campaigns and schedule appear here once a bot is connected."
                : workspace.bot
                  ? <>Every screen reads live from it, and the console keeps no copy. <span className="account-fact-ref">{workspace.bot.baseUrl}</span></>
                  : "Running on this machine, from the local bot source."}
            >
              {connected
                ? <span className="pill pill-success pill-dot">Connected</span>
                : <Link prefetch={false} className="btn" href="/setup">Set up your bot</Link>}
            </Fact>
            <Fact
              name="Setup"
              hint={skipped
                ? "You skipped the setup wizard. Nothing is missing: each page offers what it needs where it is needed."
                : "You went through the setup wizard."}
            >
              <span className={skipped ? "pill" : "pill pill-success"}>{skipped ? "Skipped" : "Finished"}</span>
            </Fact>
          </Section>
        </SettingsGroup>

        <SettingsGroup id="session" title="Session" description={SESSION_NOTE}>
          <Section className="settings-card">
            <div className="setting-row">
              <div className="setting-label">
                <h3 className="setting-name">Signed in</h3>
                <span className="setting-hint">
                  A sign-in lasts seven days in this browser. Signing out ends it now, and leaves your
                  workspace and everything in it exactly as they are.
                </span>
              </div>
              <SignOut className="setting-control account-sign-out" />
            </div>
          </Section>
        </SettingsGroup>

        <SettingsGroup id="closing" title="Closing your account" description={CLOSING_NOTE}>
          <DeleteAccountCard email={operator.email} bot={botRemoval} />
        </SettingsGroup>
      </div>
    </Shell>
  );
}
