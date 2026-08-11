export default {
    async fetch(request, env) {
        const { CLIENT_ID, CLIENT_SECRET } = env;
        const url = new URL(request.url);
        
        switch (url.pathname) {
            case "/get-access-token": {
                if (request.method !== "POST") return new Response("Expected 'POST' method", { status: 405 });

                const code = await request.text();
                if (!code) return new Response("Expected code in request body text", { status: 400 });

                return fetch("https://github.com/login/oauth/access_token", {
                    "method": "POST",
                    "headers": {
                        "Accept": "application/json",
                        "Content-Type": "application/json",                        
                    },
                    "body": JSON.stringify({
                        "code": code,
                        "client_id": CLIENT_ID,
                        "client_secret": CLIENT_SECRET
                    })
                })
            };

            case "/delete-access-token": {
                if (request.method !== "POST") return new Response("Expected 'POST' method", { status: 405 });

                const accessToken = await request.text();
                if (!accessToken) return new Response("Expected access token in request body text", { status: 400 });

                return fetch(`https://api.github.com/applications/${CLIENT_ID}/token`, {
                    method: "DELETE",
                    headers: {
                        "Authorization": `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
                        "Accept": "application/vnd.github+json",
                    },
                    body: JSON.stringify({ access_token: accessToken }),
                })
            };

            default: return new Response("Not found", { status: 404 });
        }
    }
}