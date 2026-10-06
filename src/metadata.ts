import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@gajae-code/coding-agent";

export const MODEL_KEY = "gjc_herdr_model";
export const SESSION_KEY = "gjc_herdr_session";
export const SESSION_ID_KEY = "gjc_herdr_session_id";
export const TTL_MS = 60_000;
export const REFRESH_MS = 20_000;

export function isMainSession(
	ctx: Pick<ExtensionContext, "sessionMetadata">,
): boolean {
	return (
		ctx.sessionMetadata?.kind === "main" && ctx.sessionMetadata.taskDepth === 0
	);
}

export function displayValue(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const text = Array.from(
		value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim(),
	)
		.slice(0, 80)
		.join("");
	return text || undefined;
}

export interface MetadataValues {
	model?: string;
	session?: string;
	sessionId?: string;
}

export function reportArgs(
	pane: string,
	source: string,
	seq: number,
	values: MetadataValues,
): string[] {
	const args = [
		"pane",
		"report-metadata",
		pane,
		"--source",
		source,
		"--agent",
		"gjc",
		"--applies-to-source",
		"custom:gjc",
		"--seq",
		String(seq),
		"--ttl-ms",
		String(TTL_MS),
	];
	for (const [key, value] of [
		[MODEL_KEY, values.model],
		[SESSION_KEY, values.session],
	] as const) {
		const text = displayValue(value);
		args.push(
			...(text === undefined
				? ["--clear-token", key]
				: ["--token", `${key}=${text}`]),
		);
	}
	// The session ID is a machine identity for prompt delivery, so it is never normalized.
	args.push(
		...(values.sessionId
			? ["--token", `${SESSION_ID_KEY}=${values.sessionId}`]
			: ["--clear-token", SESSION_ID_KEY]),
	);
	return args;
}

export function createReporter(
	exec: ExtensionAPI["exec"],
	pane: string,
	binPath: string,
) {
	// A fresh source has its own sequence. Herdr binds it to the GJC generation via
	// the public agent/applies-to-source fields; no native sequence is read or reused.
	const source = `gjc-herdr:${randomUUID()}`;
	let seq = 0;
	return async (values: MetadataValues): Promise<void> => {
		const result = await exec(
			binPath,
			reportArgs(pane, source, ++seq, values),
			{ timeout: 3_000 },
		);
		if (result.code !== 0 || result.killed) {
			throw new Error(
				`Herdr metadata report failed (exit ${result.code}, killed ${result.killed})`,
			);
		}
	};
}
