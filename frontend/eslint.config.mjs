import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Server code must not leak into the client bundle and vice versa.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/server/*", "@/lib/server/**"],
              message: "Server modules may only be imported from app/api routes or other server modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/api/**", "src/lib/server/**", "tests/**"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", ".data/**", "next-env.d.ts", "coverage/**"]),
]);
