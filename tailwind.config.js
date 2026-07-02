const { heroui } = require("@heroui/react");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // HeroUI component class strings live in @heroui/theme's dist (.mjs). Under
    // pnpm that package isn't at the top level, so scan the real .pnpm path.
    "./node_modules/@heroui/theme/dist/**/*.{js,mjs,cjs}",
    "./node_modules/.pnpm/**/@heroui/theme/dist/**/*.{js,mjs,cjs}",
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
          // Inherit dark's neutral gray ramps (default/content) so flat/light
          // buttons and switch tracks keep proper contrast; only recolor the
          // brand/semantic tokens to stay monochrome.
          extend: "dark",
          colors: {
            background: "#0b0b0c",
            foreground: "#e6e6e6",
            focus: "#a1a1aa",
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
              DEFAULT: "#c9c2b4",
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
