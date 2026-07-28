import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "ophiuchus",
		identifier: "com.gnosteq.ophiuchus",
		version: "0.1.0-beta.1",
	},
	build: {
		bun: {
			// The launcher hardcodes bun/index.js, so this source basename must be "index".
			entrypoint: "src/index.ts",
		},
		views: {
			workspace: {
				entrypoint: "src/workspaceIndex.ts",
			},
		},
		copy: {
			"src/workspace.html": "views/workspace/index.html",
			"src/workspace.css": "views/workspace/index.css",
			// Driver/broker/shim are read at runtime beside the bundled bun entry.
			"src/kernelDriver.py": "bun/kernelDriver.py",
			"src/kernelBroker.py": "bun/kernelBroker.py",
			"src/kernelC.py": "bun/kernelC.py",
			"src/windowShim.c": "bun/windowShim.c",
		},
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
			icon: "icon.png",
		},
		win: {
			bundleCEF: false,
			icon: "icon.ico",
		},
	},
	scripts: {
		// Electrobun's own win-icon embedding is broken (rcedit path from its CI
		// machine baked into the compiled CLI) — this hook stamps the exes instead.
		// postPackage re-runs it for the Setup exe + artifact zip (release builds).
		postBuild: "scripts/embedIcon.ts",
		postPackage: "scripts/embedIcon.ts",
	},
} satisfies ElectrobunConfig;
