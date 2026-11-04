import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Fonts are downloaded at build time and bundled, so they work offline inside the desktop app.
// Bricolage Grotesque: friendly, characterful display face for headlines and big numbers.
const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

// Figtree: clean, highly readable UI and body text.
const body = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
});

// JetBrains Mono: numbers that must align (token counts, sizes, times, ids).
const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tell Me. — ask your recordings",
  description: "Transcribe recordings on your Mac and ask questions answered only from what was said.",
};

const DIRECTION_CONTRACT = `
THESIS: Tell Me. is the calm, private way to question a recording; it proves (with charts) that it sends a fraction of the tokens, keeps audio on the Mac, and shows its sources, refusing the dark neon "AI" page.
OWN-WORLD: bright cool white, near-black ink, one electric cobalt for action and "Tell Me.", lime only as a highlighter, ember orange only for the cloud-chatbot comparison series; Bricolage Grotesque display, Figtree body, JetBrains Mono numbers; soft 20px cards floating with gentle parallax.
STORY: visitor sees the app answer a recording with its source, then sees token, privacy and grounding charts, picks a model, opens the app.
FIRST VIEWPORT: headline and Open Tell Me left; floating app cards right (question, answer with source chip, transcript passage, on-device badge) drifting on scroll.
FORM: user-pinned "Clean light + cobalt" from Awwwards references (Twain, Telescope, Wafer.ai, Orchid Security).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        {/* Inline theme initializer to prevent a flash of the wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.setAttribute('data-theme', 'dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before React loads;
          ignore those instead of reporting a hydration mismatch. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <div hidden dangerouslySetInnerHTML={{ __html: `<!--${DIRECTION_CONTRACT}-->` }} />
        {children}
      </body>
    </html>
  );
}
