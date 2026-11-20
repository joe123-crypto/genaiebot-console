"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login-page"><section className="login-card"><h1>This page could not be opened</h1>
    <p>Something went wrong while loading it. Please try again.</p><button className="btn" onClick={reset}>Try again</button></section></main>;
}
