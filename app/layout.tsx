import type { Metadata } from "next";
import "./globals.css";
import { displayTheme } from "@/src/lib/display-theme";
import { themeAttribute } from "@/src/lib/theme";

export const metadata: Metadata = {
  title: "Genaie",
  description: "Operate the Genaie WhatsApp bot: groups, campaigns, schedule and lines.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // On the root element and rendered on the server, so sign-in and every
  // console screen paint in the chosen theme from the first frame.
  const theme = await displayTheme();
  return (
    <html lang="en" data-theme={themeAttribute(theme)}>
      <body>{children}</body>
    </html>
  );
}
