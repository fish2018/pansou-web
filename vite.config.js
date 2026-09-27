import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [
      vue({
        template: {
          compilerOptions: {
            // 启用运行时编译
            isCustomElement: () => false
          }
        }
      }),
    ],
    define: {
      // Vue 3 feature flags
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // 使用包含编译器的Vue版本
        'vue': 'vue/dist/vue.esm-bundler.js'
      }
    },
    server: {
      host: 'localhost', // 确保使用localhost以支持Web Crypto API
      port: 3000,
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8888',
          changeOrigin: true
        },
        '/qqpd': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8888',
          changeOrigin: true
        },
        '/gying': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8888',
          changeOrigin: true
        },
        '/panlian': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8888',
          changeOrigin: true
        },
        '/weibo': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8888',
          changeOrigin: true
        },
        '/woniu': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8888',
          changeOrigin: true
        }
      }
    }
  }
})
