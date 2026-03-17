/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // We'll control dark mode manually or via system preference class
  theme: {
    extend: {
      colors: {
        // Semantic names based on theme.md
        background: {
          DEFAULT: '#FFFFFF',
          dark: '#0F172A',
        },
        surface: {
          primary: {
            DEFAULT: '#FFFFFF',
            dark: '#020617',
          },
          secondary: {
            DEFAULT: '#F7F7F8',
            dark: '#020617', // Note: Same as primary in dark mode per spec, but defined separately for semantic clarity
          },
          elevated: {
            DEFAULT: '#FFFFFF',
            dark: '#020617',
          }
        },
        border: {
          DEFAULT: '#E5E7EB',
          dark: '#1E293B',
        },
        divider: {
            DEFAULT: '#ECEEF1',
            dark: '#1E293B'
        },
        text: {
          primary: {
            DEFAULT: '#111827',
            dark: '#F8FAFC',
          },
          secondary: {
            DEFAULT: '#4B5563',
            dark: '#CBD5E1',
          },
          tertiary: {
            DEFAULT: '#9CA3AF',
            dark: '#64748B',
          }
        },
        accent: {
          primary: {
            DEFAULT: '#2563EB',
            dark: '#60A5FA',
          },
          hover: {
            DEFAULT: '#1D4ED8',
            dark: '#93C5FD',
          },
          muted: {
            DEFAULT: '#E0E7FF',
            dark: '#1E293B',
          }
        },
        status: {
            success: { DEFAULT: '#16A34A', dark: '#22C55E' },
            warning: { DEFAULT: '#D97706', dark: '#F59E0B' },
            error: { DEFAULT: '#DC2626', dark: '#EF4444' }
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', "Liberation Mono", "Courier New", 'monospace'],
      }
    },
  },
  plugins: [],
}
