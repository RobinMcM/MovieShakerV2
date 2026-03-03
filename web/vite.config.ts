import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const supertokensRoot = path.resolve(__dirname, "node_modules/supertokens-auth-react")
const libBuild = path.join(supertokensRoot, "lib/build")

// SuperTokens uses relative require() without .js; alias those exact ids so Vite's resolver finds the built files.
const supertokensAliases: [string, string][] = [
    ["./lib/build/", path.join(libBuild, "index.js")],
    ["../../lib/build/emailpassword", path.join(libBuild, "emailpassword.js")],
    ["../../lib/build/emailpasswordprebuiltui", path.join(libBuild, "emailpasswordprebuiltui.js")],
    ["../../lib/build/session", path.join(libBuild, "session.js")],
    ["../lib/build/ui-entry", path.join(libBuild, "ui-entry.js")],
]

// During optimizeDeps, esbuild resolves relative requires; add .js for SuperTokens lib/build paths that lack extension.
// Only handle relative paths (./ or ../) so we don't rewrite bare specifiers like "react" or "supertokens-web-js/...".
function supertokensEsbuildPlugin() {
    return {
        name: "supertokens-resolve-js",
        setup(build: any) {
            build.onResolve({ filter: /^\.\.?\// }, (args: { path: string; importer: string }) => {
                if (!args.importer?.includes("supertokens-auth-react")) return null
                const dir = path.dirname(args.importer)
                const resolved = path.resolve(dir, args.path)
                const normalized = path.normalize(resolved)
                if (!normalized.startsWith(libBuild)) return null
                if (normalized.endsWith(".js") || normalized.endsWith(".json")) return null
                // "./lib/build/" or "lib/build" directory -> index.js
                if (normalized === libBuild || normalized === libBuild + path.sep) {
                    return { path: path.join(libBuild, "index.js"), namespace: "file" }
                }
                return { path: resolved + ".js", namespace: "file" }
            })
        },
    }
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: [
            { find: "@", replacement: path.resolve(__dirname, "./src") },
            ...supertokensAliases.map(([find, replacement]) => ({ find, replacement })),
        ],
    },
    optimizeDeps: {
        exclude: [
            "supertokens-auth-react",
            "supertokens-auth-react/recipe/emailpassword",
            "supertokens-auth-react/recipe/session",
        ],
        include: [
            "supertokens-auth-react/recipe/emailpassword/prebuiltui",
            "supertokens-auth-react/ui",
        ],
        esbuildOptions: {
            plugins: [supertokensEsbuildPlugin()],
        },
    },
    server: {
        host: true, // Needed for Docker
        port: 5173
    }
})
