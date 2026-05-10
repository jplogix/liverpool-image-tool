import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

function imageProxy(): Plugin {
	return {
		name: "local-image-proxy",
		configureServer(server) {
			server.middlewares.use("/image-proxy", async (request, response) => {
				const requestUrl = new URL(request.url ?? "", "http://localhost");
				const imageUrlEncoded = requestUrl.searchParams.get("url");
      const imageUrl = imageUrlEncoded ? decodeURIComponent(imageUrlEncoded) : null;

				if (!imageUrl) {
					response.statusCode = 400;
					response.end("Missing image URL.");
					return;
				}

				try {
					const parsed = new URL(imageUrl);
					if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
						response.statusCode = 400;
						response.end("Unsupported image URL protocol.");
						return;
					}

					const upstream = await fetch(parsed, {
						headers: {
							"User-Agent":
								"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
							Accept: "image/*,*/*",
						},
					});
					if (!upstream.ok) {
						response.statusCode = upstream.status;
						response.end(`Image request failed: ${upstream.statusText}`);
						return;
					}

					const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
					response.setHeader("Content-Type", contentType);
					response.setHeader("Access-Control-Allow-Origin", "*");
					response.end(Buffer.from(await upstream.arrayBuffer()));
				} catch (error) {
					response.statusCode = 502;
					response.end(error instanceof Error ? error.message : "Image proxy failed.");
				}
			});
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), imageProxy()],
});
