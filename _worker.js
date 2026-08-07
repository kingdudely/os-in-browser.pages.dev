export default {
	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === "/login/oauth/access_token") {
			return fetch(
				new Request("https://github.com/login/oauth/access_token", request)
			);
		}

		return new Response("Not found", { status: 404 });
	}
};