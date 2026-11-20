"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login-page"><section className="login-card"><h1>The console is unavailable</h1>
    <p>We could not open this page securely. Please try again.</p><button className="btn" onClick={reset}>Try again</button></section></main>;
}
