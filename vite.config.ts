import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

export default defineConfig({
  plugins: [
    vinext({
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      // Workers AI has no local simulator. Without a token, keep every binding local
      // so `vite dev` does not open a Cloudflare login. MOCK_AI covers plan generation.
      remoteBindings: Boolean(process.env.CLOUDFLARE_API_TOKEN),
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
