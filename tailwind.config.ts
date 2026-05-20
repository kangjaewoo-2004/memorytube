import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#161615",
        paper: "#f8f7f4",
        line: "#e7e1d8",
        mint: "#0f766e",
        gold: "#b7791f"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(22, 22, 21, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
