import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const signalTarget = env.VITE_DEV_SIGNAL_TARGET || "http://localhost:8787";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/signal": {
          target: signalTarget,
          ws: true
        }
      }
    }
  };
});
