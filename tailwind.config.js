/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'Manrope', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: { 50: '#F3F5FA', 100: '#E4E8F3', 200: '#C7CFE4', 300: '#9AA6C8', 400: '#6B7AA6', 500: '#4A5A8A', 600: '#34437A', 700: '#283565', 800: '#1D2750', 900: '#141B3A' },
        paper: '#F5F6F9',
      },
    },
  },
  plugins: [],
};
