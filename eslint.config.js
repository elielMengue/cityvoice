import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/cdk.out/**",
            "**/.wrangler/**",
            "simulator/public/app.js",
            "simulator/public/chunks/**",
            "server/src/ui/generated/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/consistent-type-imports": "error",
            "no-var": "error",
            "prefer-const": "error",
        },
    },
);
