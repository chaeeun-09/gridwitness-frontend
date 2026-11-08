import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /gw-api 가 붙을 백엔드. 기본은 학교 서버, 이 PC 백엔드를 쓰려면 GW_API_TARGET=http://127.0.0.1:8000
const apiTarget = process.env.GW_API_TARGET ?? 'https://gridwitness-api.https.gsmsv.site'

// https://vite.dev/config/
// GitHub Pages처럼 하위 경로(/저장소이름/)에 배포할 때는 VITE_BASE로 지정 (Vercel·로컬은 기본 '/')
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    proxy: {
      '/gw-api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gw-api/, ''),
      },
    },
  },
  preview: {
    proxy: {
      '/gw-api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gw-api/, ''),
      },
    },
  },
})
