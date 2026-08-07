export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        switch (url.pathname) {
            case "/get-access-token": {
                if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

                const body = await request.json();
                const cookies = parseCookies(request.headers.get("Cookie"));

                // Fall back to cookie refresh_token if client didn't explicitly pass one
                const refreshToken = body.refresh_token || cookies.refresh_token;

                // Determine payload based on grant type
                const payload = body.grant_type === "refresh_token" 
                    ? {
                        client_id: env.CLIENT_ID,
                        client_secret: env.CLIENT_SECRET,
                        grant_type: "refresh_token",
                        refresh_token: refreshToken
                    }
                    : {
                        client_id: env.CLIENT_ID,
                        client_secret: env.CLIENT_SECRET,
                        code: body.code,
                        code_verifier: body.code_verifier
                    };

                const ghResponse = await fetch("https://github.com/login/oauth/access_token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await ghResponse.json();

                if (data.error) {
                    return new Response(JSON.stringify(data), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }

                const response = new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });

                // 1. Set Access Token Cookie (Short-lived, e.g., 8 hours / 28800s)
                const accessMaxAge = data.expires_in || 28800;
                response.headers.append(
                    "Set-Cookie",
                    `access_token=${data.access_token}; Path=/; Max-Age=${accessMaxAge}; Secure; SameSite=Lax`
                );

                // 2. Set Refresh Token Cookie (Long-lived, e.g., 6 months / 15552000s)
                if (data.refresh_token) {
                    const refreshMaxAge = data.refresh_token_expires_in || 15552000;
                    response.headers.append(
                        "Set-Cookie",
                        `refresh_token=${data.refresh_token}; Path=/; Max-Age=${refreshMaxAge}; Secure; SameSite=Lax`
                    );
                }

                return response;
            }

            case "/logout": {
                if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

                const cookies = parseCookies(request.headers.get("Cookie"));
                
                // Revoke active access token on GitHub side if present
                if (cookies.access_token) {
                    await fetch(`https://api.github.com/applications/${env.CLIENT_ID}/token`, {
                        method: "DELETE",
                        headers: {
                            "Accept": "application/vnd.github+json",
                            "Authorization": "Basic " + btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`),
                            "Content-Type": "application/json",
                            "X-GitHub-Api-Version": "2022-11-28"
                        },
                        body: JSON.stringify({ access_token: cookies.access_token })
                    });
                }

                const response = new Response(JSON.stringify({ success: true }), { status: 200 });

                // Clear both cookies by setting Max-Age to 0
                response.headers.append("Set-Cookie", "access_token=; Path=/; Max-Age=0; Secure; SameSite=Lax");
                response.headers.append("Set-Cookie", "refresh_token=; Path=/; Max-Age=0; Secure; SameSite=Lax");

                return response;
            }

            default:
                return new Response("Not Found", { status: 404 });
        }
    }
};

// Simple cookie parser helper
function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(";").forEach(cookie => {
        const [name, ...rest] = cookie.split("=");
        list[name.trim()] = rest.join("=").trim();
    });
    return list;
}