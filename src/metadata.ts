import type { ExtensionContext } from "@gajae-code/coding-agent";

export function isMainSession(
	ctx: Pick<ExtensionContext, "sessionMetadata">,
): boolean {
	return (
		ctx.sessionMetadata?.kind === "main" && ctx.sessionMetadata.taskDepth === 0
	);
}

export function isInteractiveMainSession(
	ctx?: Pick<ExtensionContext, "hasUI" | "sessionMetadata">,
): boolean {
	return Boolean(ctx) && ctx!.hasUI === true && isMainSession(ctx!);
}
