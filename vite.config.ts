import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

export default defineConfig({
  base: '/nba_cut_trade_sign/',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
