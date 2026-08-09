// OpenNext → Cloudflare Workers adapter configuration.
// Defaults are enough: this lab has no incremental static regeneration to
// cache — every page is either static chrome or rendered per request against
// the session.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
