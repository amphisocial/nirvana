import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A2540",       // navy — primary text & dark buttons
        brand: "#1D4ED8",     // primary blue
        forest: "#1D4ED8",    // (alias kept) → blue
        forest2: "#0A2540",   // dark navy panels/footer
        ivory: "#F6F8FB",     // app background (very light blue-gray)
        ivory2: "#EEF2F7",    // section shade
        brass: "#2563EB",     // accent / primary CTA (blue)
        brass2: "#3B82F6",    // light blue
        sage: "#64748B",      // slate secondary text
        gain: "#16A34A",
        loss: "#DC2626",
        line: "#E2E8F0",      // hairline on light
        lineDark: "#1E3A5F",  // hairline on navy
      },
      fontFamily: {
        display: ["var(--font-display)", "Arial", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,37,64,0.04), 0 8px 24px -16px rgba(10,37,64,0.25)",
        badge: "0 18px 40px -22px rgba(10,37,64,0.45)",
      },
      borderRadius: { xl2: "1rem" },
    },
  },
  plugins: [],
};
export default config;
