import type { ExtensionAPI, ExtensionContext } from "@gajae-code/coding-agent";
import { resolveHerdrPaneEnvironment } from "@gajae-code/coding-agent/utils/herdr-pane";
import { createReporter, isMainSession, REFRESH_MS } from "./metadata.ts";
import { registerSendFeatures } from "./send.ts";
import { registerCallFeatures } from "./call.ts";
import { registerMailFeatures } from "./mail.ts";
import { registerMailReceiver } from "./mail-receive.ts";

export type BackendKind = "herdr" | "hc";

export const INVALID_BACKEND_WARNING =
	"Invalid GJC_HERDR_BACKEND value ignored; using automatic backend selection.";

export function selectBackend(
	env: NodeJS.ProcessEnv | Record<string, string | undefined>,
	helperPane: { paneId: string; binPath: string } | null | undefined,
	logger?: { warn?: (message: string) => void },
): BackendKind {
	const forced = env.GJC_HERDR_BACKEND;
	if (forced === "herdr" || forced === "hc") {
		return forced;
	}
	if (forced !== undefined) {
		logger?.warn?.(INVALID_BACKEND_WARNING);
	}
	if (helperPane) return "herdr";
	if (typeof env.HC_TERMINAL_ID === "string" && env.HC_TERMINAL_ID.trim()) {
		return "hc";
	}
	return "herdr";
}

export default function herdrMetadata(api: ExtensionAPI): void {
	api.logger.info("gjc-herdr extension loaded");
	const pane = resolveHerdrPaneEnvironment({ env: { ...process.env } });
	const backend = selectBackend(process.env, pane, api.logger);
	const hcBin = process.env.GJC_HERDR_HC_BIN?.trim() || "hc";
	const senderPane = pane?.paneId ?? process.env.HERDR_PANE_ID;
	const hcCallerId = process.env.HC_TERMINAL_ID?.trim() || undefined;
	// Explicit delivery to another pane does not depend on this process publishing metadata.
	registerSendFeatures(
		api,
		pane?.binPath ?? "herdr",
		senderPane,
		{
			backend,
			hcBin,
			hcCallerId,
		},
	);
	registerCallFeatures(
		api,
		pane?.binPath ?? "herdr",
		senderPane,
		{
			backend,
			hcBin,
			hcCallerId,
		},
	);
	registerMailFeatures(api);
	registerMailReceiver(api);
	if (!pane) return;

	const report = createReporter(api.exec.bind(api), pane.paneId, pane.binPath);
	let context: ExtensionContext | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let stopping = false;
	let tail = Promise.resolve();

	function enqueue(action: () => Promise<void>): Promise<void> {
		tail = tail.then(action).catch((error: unknown) => {
			api.logger.warn("gjc-herdr metadata update failed", {
				reason:
					error instanceof Error ? error.message : "Unknown metadata error",
			});
		});
		return tail;
	}

	function refresh(): Promise<void> {
		return enqueue(async () => {
			if (stopping || !context || !isMainSession(context)) return;
			// ctx.model is a live public getter. Session names are read, never set.
			const model = context.model;
			await report({
				model: model ? `${model.provider}/${model.id}` : undefined,
				session: api.getSessionName(),
				sessionId: context.sessionManager.getSessionId(),
			});
		});
	}

	async function update(_event: unknown, ctx: ExtensionContext): Promise<void> {
		if (stopping || !isMainSession(ctx)) return;
		context = ctx;
		if (!timer) {
			timer = setInterval(() => {
				void refresh();
			}, REFRESH_MS);
			timer.unref();
		}
		await refresh();
	}

	api.on("session_start", update);
	api.on("session_switch", update);
	api.on("agent_start", update);
	api.on("agent_end", update);
	api.on("session_shutdown", async () => {
		stopping = true;
		if (timer) clearInterval(timer);
		if (context) await enqueue(() => report({}));
	});
}
