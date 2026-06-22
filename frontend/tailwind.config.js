/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand accent matches the PDF blue/violet (docs/07 §1). Tokenised so we
        // never hardcode hex in components.
        brand: {
          DEFAULT: "#6C4CF1",
          50: "#f3f0fe",
          100: "#e7e0fd",
          200: "#cfc1fb",
          300: "#b09bf6",
          400: "#8f6ff1",
          500: "#6C4CF1",
          600: "#5a37d9",
          700: "#4a2cb4",
          800: "#3d2693",
          900: "#332377",
        },
        success: { DEFAULT: "#059669", soft: "#d1fae5" },
        warning: { DEFAULT: "#d97706", soft: "#fef3c7" },
        danger: { DEFAULT: "#dc2626", soft: "#fee2e2" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06)",
        pop: "0 8px 30px rgba(15,23,42,0.12)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
      },
    },
  },
  plugins: [],
};
