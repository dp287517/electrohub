/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff', 100: '#d9edff', 200: '#bfe0ff', 300: '#94cdff',
          400: '#62b0ff', 500: '#3b92ff', 600: '#1f73ff', 700: '#125ef0',
          800: '#0f49bf', 900: '#0f3e99',
        },
      },
      boxShadow: {
        soft: '0 10px 30px rgba(0,0,0,0.08)'
      }
    },
  },
  plugins: [],
};
