import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ecu: {
          black: '#050505',
          charcoal: '#1c1f1f',
          teal: '#2fb7a6',
          green: '#1f8f7d',
          mint: '#e6f7f4',
          leaf: '#b9dfd6',
          ink: '#151817',
          mist: '#f2f7f6'
        }
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.06)'
      }
    },
  },
  plugins: [],
} satisfies Config;
