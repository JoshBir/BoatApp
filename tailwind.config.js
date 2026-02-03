/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html",
  ],
  theme: {
    extend: {
      colors: {
        'marine-blue': '#0D47A1',
        'marine-light': '#1976D2',
        'marine-dark': '#002171',
        'positive': '#dc2626',
        'negative': '#1d4ed8',
        'ground': '#16a34a',
      },
    },
  },
  plugins: [],
};
