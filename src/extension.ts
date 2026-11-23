import type { ExtensionAPI } from "@gajae-code/coding-agent";
import { registerSendFeatures } from "./send.ts";
import { registerCallFeatures } from "./call.ts";
import { registerMailFeatures } from "./mail.ts";
import { registerMailReceiver } from "./mail-receive.ts";

export default function herdrMetadata(api: ExtensionAPI): void {
	api.logger.info("gjc-herdr extension loaded");
	if (process.env.GJC_HERDR_DISABLE === "1") {
		api.logger.info("gjc-herdr disabled by GJC_HERDR_DISABLE=1");
		return;
	}
	const hcCallerId = process.env.HC_TERMINAL_ID?.trim() || undefined;
	if (hcCallerId) {
		const hcBin = process.env.GJC_HERDR_HC_BIN?.trim() || "hc";
		registerSendFeatures(api, { hcBin, hcCallerId });
		registerCallFeatures(api, { hcBin, hcCallerId });
	}
	registerMailFeatures(api);
	registerMailReceiver(api);
}
