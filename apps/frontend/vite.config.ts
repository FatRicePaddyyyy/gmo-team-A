import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

export default defineConfig({
	server: {
		// ngrok などのトンネル越しに dev サーバーを見せるとき、Vite が
		// 「知らないホスト名からのアクセス」として 403 で弾くため許可する。
		// 無料プランは起動のたびに URL が変わるので、ドメイン全体を許可している。
		allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
	},
	plugins: [
		vinext({
			cache: { cdn: cdnAdapter() },
			images: { optimizer: imagesOptimizer() },
		}),
		cloudflare({
			viteEnvironment: {
				name: "rsc",
				childEnvironments: ["ssr"],
			},
		}),
	],
});
