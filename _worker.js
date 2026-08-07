export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const body = await request.json();

		switch (url.pathname) {
			case "/logout": {
				const response = await fetch(
					`https://api.github.com/applications/${env.CLIENT_ID}/token`,
					{
						method: "DELETE",
						headers: {
							"Accept": "application/vnd.github+json",
							"Authorization": "Basic " + btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`),
							"Content-Type": "application/json",
							"X-GitHub-Api-Version": "2026-03-10"
						},
						body: JSON.stringify({ access_token: body.access_token })
					}
				);
				// 204 on success, no body
				return new Response(null, { status: response.status });
			}

			case "/get-access-token": {
				return fetch("https://github.com/login/oauth/access_token", {
					method: "POST",
					headers: { "Content-Type": "application/json", "Accept": "application/json" },
					body: JSON.stringify({
						client_id: env.CLIENT_ID,
						client_secret: env.CLIENT_SECRET,
						...body
					})
				});
			}
		}
	}
};