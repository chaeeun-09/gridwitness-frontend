import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// GitHub Pages처럼 하위 경로(/저장소이름/)에 배포할 때는 VITE_BASE로 지정 (Vercel·로컬은 기본 '/')
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
})
