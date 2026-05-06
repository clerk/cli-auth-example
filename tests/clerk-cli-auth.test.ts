import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ClerkCliAuth } from "../src/clerk-cli-auth.js";

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, statusCode: number, body: unknown): void {
	res.writeHead(statusCode, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

describe("ClerkCliAuth", () => {
	const servers: ReturnType<typeof createServer>[] = [];

	afterEach(async () => {
		await Promise.all(
			servers.splice(0).map(
				(server) =>
					new Promise<void>((resolve) => {
						server.close(() => resolve());
					}),
			),
		);
	});

	it("runs the localhost callback flow against stubbed OAuth endpoints", async () => {
		let tokenRequest: URLSearchParams | undefined;
		let userinfoAuthorization: string | undefined;
		let authorizeUrl: URL | undefined;

		const issuerServer = createServer(async (req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");

			if (req.method === "POST" && url.pathname === "/oauth/token") {
				tokenRequest = new URLSearchParams(await readBody(req));
				json(res, 200, {
					access_token: "access-token",
					refresh_token: "refresh-token",
					id_token: "id-token",
					expires_in: 3600,
					scope: "profile email openid offline_access",
					token_type: "Bearer",
				});
				return;
			}

			if (req.method === "GET" && url.pathname === "/oauth/userinfo") {
				userinfoAuthorization = req.headers.authorization;
				json(res, 200, {
					sub: "user_123",
					email: "test@example.com",
					name: "Test User",
				});
				return;
			}

			json(res, 404, { error: "not_found" });
		});
		servers.push(issuerServer);

		await new Promise<void>((resolve) => issuerServer.listen(0, "127.0.0.1", resolve));
		const issuerPort = (issuerServer.address() as AddressInfo).port;
		const issuer = `http://127.0.0.1:${issuerPort}`;

		const auth = new ClerkCliAuth({
			clientId: "client_123",
			issuer,
			storage: "memory",
			openBrowser: async (url) => {
				authorizeUrl = new URL(url);
				const redirectUri = authorizeUrl.searchParams.get("redirect_uri");
				const state = authorizeUrl.searchParams.get("state");
				expect(redirectUri).toBeTruthy();
				expect(state).toBeTruthy();

				const callbackUrl = new URL(redirectUri ?? "");
				callbackUrl.searchParams.set("code", "auth-code");
				callbackUrl.searchParams.set("state", state ?? "");

				const response = await fetch(callbackUrl);
				expect(response.status).toBe(200);
			},
		});

		const result = await auth.login();

		expect(authorizeUrl?.pathname).toBe("/oauth/authorize");
		expect(authorizeUrl?.searchParams.get("response_type")).toBe("code");
		expect(authorizeUrl?.searchParams.get("client_id")).toBe("client_123");
		expect(authorizeUrl?.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorizeUrl?.searchParams.get("scope")).toBe("profile email openid offline_access");

		expect(tokenRequest?.get("grant_type")).toBe("authorization_code");
		expect(tokenRequest?.get("client_id")).toBe("client_123");
		expect(tokenRequest?.get("code")).toBe("auth-code");
		expect(tokenRequest?.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(tokenRequest?.get("redirect_uri")).toBe(authorizeUrl?.searchParams.get("redirect_uri"));

		expect(userinfoAuthorization).toBe("Bearer access-token");
		expect(result.tokens.accessToken).toBe("access-token");
		expect(result.tokens.refreshToken).toBe("refresh-token");
		expect(result.user).toMatchObject({ sub: "user_123", email: "test@example.com" });

		await expect(auth.getAccessToken()).resolves.toBe("access-token");
		await expect(auth.whoami()).resolves.toMatchObject({ sub: "user_123" });
	});
});
