/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          950: '#0B0F17',
          900: '#0F1420',
          850: '#131824',
          800: '#171D2B',
          700: '#1E2537',
          600: '#28324A',
          500: '#3A4560',
        },
        violet: {
          500: '#8B5CF6',
          400: '#A78BFA',
          300: '#C4B5FD',
          600: '#7C3AED',
        },
        cyan: {
          400: '#06B6D4',
          300: '#22D3EE',
          500: '#0891B2',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'skeleton-shift': 'skeletonShift 1.5s ease-in-out infinite',
        'word-fade': 'wordFade 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16,1,0.3,1)',
        'fade-in': 'fadeIn 0.3s ease-out',
        'border-flow': 'borderFlow 3s linear infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(139,92,246,0.4), 0 0 40px rgba(139,92,246,0.2)' },
          '50%': { boxShadow: '0 0 30px rgba(139,92,246,0.7), 0 0 60px rgba(139,92,246,0.4)' },
        },
        skeletonShift: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        wordFade: {
          '0%': { opacity: '0.4', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        borderFlow: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      backgroundImage: {
        'glow-violet': 'radial-gradient(circle at center, rgba(139,92,246,0.15) 0%, transparent 70%)',
        'glow-cyan': 'radial-gradient(circle at center, rgba(6,182,212,0.15) 0%, transparent 70%)',
        'gradient-flow': 'linear-gradient(270deg, #8B5CF6, #06B6D4, #8B5CF6)',
      },
    },
  },
  plugins: [],
};
