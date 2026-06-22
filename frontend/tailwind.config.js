/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand accent matches the PDF blue (docs/07 §1). Tokenised so we
        // never hardcode hex in components.
        brand: {
          DEFAULT: "#6C4CF1",
          50: "#f1eefe",
          100: "#e4ddfd",
          500: "#6C4CF1",
          600: "#5a3ad6",
          700: "#4a2fb0",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
