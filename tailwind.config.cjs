/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './job-search.html', './scripts/career-assistant.js', './p0/public/profile-adapter.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#EEF2FF', 100: '#E0E7FF', 200: '#C7D2FE', 300: '#A5B4FC',
          400: '#818CF8', 500: '#6366F1', 600: '#4F46E5', 700: '#4338CA',
        },
        accent: { 400: '#2DD4BF', 500: '#14B8A6', 600: '#0D9488' },
        warm: { 50: '#FAFAF9', 100: '#F5F5F4' },
      },
      animation: {
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
        'fade-up': 'fadeUp 0.4s ease-out',
      },
      keyframes: {
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.7' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
};
