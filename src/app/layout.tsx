import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SeeWe — AI-Powered Hiring & Job Platform",
  description:
    "SeeWe is a full-stack recruitment marketplace: candidates discover jobs, recruiters post jobs and search talent, and a SeeWe AI Interviewer conducts spoken video interviews, rates candidates, and shares rating reports with clients.",
  keywords: ["SeeWe", "jobs", "recruitment", "AI interview", "hiring", "job search", "job portal"],
  authors: [{ name: "SeeWe" }],
  openGraph: {
    title: "SeeWe — AI-Powered Hiring Platform",
    description: "Post jobs. Search talent. AI interviews with instant ratings — shared with clients.",
    siteName: "SeeWe",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#1B82BD",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
