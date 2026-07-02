const { heroui } = require("@heroui/react");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  darkMode: "class",
  plugins: [
    heroui({
      defaultTheme: "mono-dark",
      themes: {
        // Near-monochrome: grayscale UI with a single restrained red for
        // destructive/error affordances only.
        "mono-dark": {
          extend: "dark",
          colors: {
            background: "#0b0b0c",
            foreground: "#e6e6e6",
            focus: "#a1a1aa",
            content1: "#141416",
            content2: "#1c1c1f",
            content3: "#26262a",
            content4: "#34343a",
            divider: "rgba(255,255,255,0.10)",
            default: {
              50: "#0e0e10",
              100: "#161618",
              200: "#26262a",
              300: "#34343a",
              400: "#52525b",
              500: "#71717a",
              600: "#a1a1aa",
              700: "#d4d4d8",
              800: "#e4e4e7",
              900: "#fafafa",
              DEFAULT: "#26262a",
              foreground: "#e6e6e6",
            },
            primary: {
              50: "#1c1c1f",
              100: "#26262a",
              200: "#3f3f46",
              300: "#52525b",
              400: "#71717a",
              500: "#a1a1aa",
              600: "#d4d4d8",
              700: "#e4e4e7",
              800: "#f4f4f5",
              900: "#ffffff",
              DEFAULT: "#e4e4e7",
              foreground: "#0b0b0c",
            },
            secondary: {
              DEFAULT: "#3f3f46",
              foreground: "#e6e6e6",
            },
            success: {
              DEFAULT: "#d4d4d8",
              foreground: "#0b0b0c",
            },
            warning: {
              DEFAULT: "#a1a1aa",
              foreground: "#0b0b0c",
            },
            danger: {
              DEFAULT: "#c9484c",
              foreground: "#ffffff",
            },
          },
          layout: {
            radius: {
              small: "4px",
              medium: "6px",
              large: "8px",
            },
            fontSize: {
              tiny: "0.72rem",
              small: "0.8rem",
              medium: "0.9rem",
              large: "1.05rem",
            },
          },
        },
      },
    }),
  ],
};
