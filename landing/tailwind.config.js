/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#F2F0E9',
        charcoal: '#1A1A1A',
        moss: '#3D5A45',
        clay: '#D4C5B0',
        accent: '#FF5C1A',
        electric: '#00D9AA',
        indigo: '#635BFF',
      },
      fontFamily: {
        sans:    ['"Geist Sans"', 'sans-serif'],
        display: ['"Geist Pixel Square"', '"Geist Mono"', 'monospace'],
        mono:    ['"Geist Pixel Square"', '"Geist Mono"', 'monospace'],
        pixel:   ['"Geist Pixel Square"', '"Geist Mono"', 'monospace'],
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
        '6xl': '3rem',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(400%)' },
        },
        orbit: {
          '0%': { transform: 'rotate(0deg) translateX(40px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(40px) rotate(-360deg)' },
        },
        drift: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        ekg: {
          '0%': { strokeDashoffset: '1000' },
          '100%': { strokeDashoffset: '0' },
        },
      },
      animation: {
        'pulse-slow': 'pulse 2s ease-in-out infinite',
        'scan': 'scan 2.5s linear infinite',
        'orbit': 'orbit 4s linear infinite',
        'drift': 'drift 4s ease-in-out infinite',
        'blink': 'blink 1s step-end infinite',
        'ekg': 'ekg 3s linear infinite',
      },
    },
  },
  plugins: [],
};
