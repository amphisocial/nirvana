import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0C1512",       // near-black bottle green — text & dark surfaces
        forest: "#173D30",    // brand green
        forest2: "#0F2A21",   // deeper green
        ivory: "#F6F3EA",     // warm paper
        ivory2: "#EFEBDE",    // paper shade
        brass: "#B8892B",     // premium accent
        brass2: "#D9B25A",    // light brass
        sage: "#6E7F6A",      // muted secondary
        gain: "#2E7D46",
        loss: "#B23A32",
        line: "#D8D2C2",      // hairline on ivory
        lineDark: "#254A3C",  // hairline on ink
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(12,21,18,0.04), 0 12px 30px -18px rgba(12,21,18,0.35)",
        badge: "0 18px 40px -22px rgba(12,21,18,0.55)",
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
export default config;
