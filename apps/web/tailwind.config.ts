import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderWidth: {
        hairline: "var(--border-width-hairline)",
      },
      colors: {
        border: "var(--color-border)",
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        midnight: "var(--color-midnight)",
        whisper: "var(--color-whisper)",
        pulse: "var(--color-pulse)",
        mist: "var(--color-mist)",
        growth: "var(--color-growth)",
        ivory: "var(--color-ivory)",
        health: {
          amber: "var(--color-health-amber)",
          red: "var(--color-health-red)",
        },
        muted: {
          DEFAULT: "var(--color-muted)",
          foreground: "var(--color-muted-foreground)",
        },
        primary: {
          DEFAULT: "var(--color-primary)",
          foreground: "var(--color-primary-foreground)",
          hover: "var(--color-primary-hover)",
        },
        secondary: {
          DEFAULT: "var(--color-secondary)",
          foreground: "var(--color-secondary-foreground)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-accent-foreground)",
        },
        ring: "var(--color-ring)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        content: "1200px",
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
