import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-fg) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-fg) / <alpha-value>)",
        },
        replay: {
          DEFAULT: "hsl(var(--replay) / <alpha-value>)",
          foreground: "hsl(var(--replay-fg) / <alpha-value>)",
        },
        live: {
          DEFAULT: "hsl(var(--live) / <alpha-value>)",
          foreground: "hsl(var(--live-fg) / <alpha-value>)",
        },
        "surface-2": "hsl(var(--surface-2) / <alpha-value>)",
        "bg-grid": "hsl(var(--bg-grid) / <alpha-value>)",
        "text-3": "hsl(var(--text-3) / <alpha-value>)",
        "border-soft": "hsl(var(--border-soft) / <alpha-value>)",
        "live-fg": "hsl(var(--live-fg) / <alpha-value>)",
        "replay-fg": "hsl(var(--replay-fg) / <alpha-value>)",
        "success-fg": "hsl(var(--success-fg) / <alpha-value>)",
        "warning-fg": "hsl(var(--warning-fg) / <alpha-value>)",
        "fail-fg": "hsl(var(--fail-fg) / <alpha-value>)",
        "diff-add-bg": "hsl(var(--diff-add-bg) / <alpha-value>)",
        "diff-add-bar": "hsl(var(--diff-add-bar) / <alpha-value>)",
        "diff-del-bg": "hsl(var(--diff-del-bg) / <alpha-value>)",
        "diff-del-bar": "hsl(var(--diff-del-bar) / <alpha-value>)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
