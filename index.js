// Pointer lock makes events added to "screenshare" element not work since document.body is the one requesting for pointer lock - a child of "window".
window.addEventListener("error", (event) => {
	const errorMessage = event.message || "Unknown error occurred";
    window.alert(`Error:\n${errorMessage}`);
});

window.addEventListener("unhandledrejection", (event) => {
    const asyncErrorMessage = event.reason?.message || event.reason || "Unknown async error occurred";
    window.alert(`Async error:\n${asyncErrorMessage}`);
});

import codeMap from "./code-map.json" with { type: "json" };

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
		navigator.wakeLock?.request('screen');
	}
});

const screenshare = document.getElementById("screenshare");
const mainDialog = document.getElementById("main-dialog");
const sharedBytes = new Uint8Array(13);
const sharedView = new DataView(sharedBytes.buffer);
const CLIENT_ID = "Iv23liyBVjlZRV5r16UD";
const APP_SLUG = "os-in-browser";

// Template that gets generated into each user's own account, and the
// name it's generated under. The app installation is then scoped to
// just this one generated repo (see ensureReady / ensureRepoGenerated).
const TEMPLATE_OWNER = "kingdudely";
const TEMPLATE_REPO = "os-in-browser-runner-template";
const RUNNER_REPO_NAME = "os-in-browser-runner";

mainDialog.showModal();
mainDialog.addEventListener('cancel', (event) => event.preventDefault());

// 1. Login Handler
document.getElementById("login-button").addEventListener("click", () => {
    startOAuthFlow("https://github.com/login/oauth/authorize");
});

// 4. Logout Handler
document.getElementById("logout-button").addEventListener("click", async () => {
    try {
        await fetch("/logout", { method: "POST" });
    } catch (error) {
        console.warn("Server logout failed, clearing locally:", error);
    } finally {
        await clearCookiesLocally();
        setAppLoggedIn(false);
    }
});

// ---- Boot sequence ----
const cameFromCallback = await handleOAuthCallback();
if (!cameFromCallback) {
    await restoreSession();
}
await ensureReady();

document.getElementById("start-runner").addEventListener("submit", async (event) => {
	event.preventDefault();

	const ready = await ensureReady();
	if (!ready) return; // gate screen is now showing, or redirect is happening

	const accessToken = (await cookieStore.get("access_token"))?.value;
	mainDialog.close();

	const formData = new FormData(event.target);
	const os = formData.get("os");

	const peer = new RTCPeerConnection({
		iceServers: [
			{ urls: "stun:stun.l.google.com:19302" }
		]
	});

	peer.addEventListener("connectionstatechange", () => {
		console.log(`ICE connection state: ${peer.connectionState}`);
		if (["disconnected", "closed"].includes(peer.connectionState)) {
			mainDialog.showModal();
		}
	});

	peer.addEventListener("track", (event) => {
		screenshare.srcObject = event.streams[0];
		screenshare.play().catch(console.warn);
	});

	peer.addTransceiver("video", {
		direction: "recvonly"
	});

	const topicName = encodeURIComponent(crypto.randomUUID());
	const topicUrl = `https://ntfy.sh/${topicName}`;
	const topic = new EventSource(`${topicUrl}/sse`);
	peer.addEventListener("icecandidate", (event) => {
		if (!event.candidate || event.candidate.type === "host") return;

		fetch(topicUrl, {
			method: "POST",
			headers: {
				"Title": "answer-candidate",
				"Filename": "file.txt"
			},
			body: JSON.stringify(event.candidate),
		});
	});

	const setRemoteDescriptionCompleted = Promise.withResolvers();
	topic.addEventListener("message", async (event) => {
		const { title, attachment } = JSON.parse(event.data);
		if (!attachment) return;

		const message = await (await fetch(attachment.url)).text();

		switch (title) {
			case "offer": {
				await peer.setRemoteDescription({ type: "offer", sdp: message });
				setRemoteDescriptionCompleted.resolve();

				await peer.setLocalDescription();
				await fetch(topicUrl, {
					method: "POST",
					headers: {
						"Title": "answer",
						"Filename": "file.txt"
					},
					body: peer.localDescription.sdp,
				});
				break;
			};

			case "offer-candidate": {
				await setRemoteDescriptionCompleted.promise;
				await peer.addIceCandidate(JSON.parse(message));
				break;
			};
		}
	});

	const pointerMovementChannel = peer.createDataChannel("pointer-movement", {
		ordered: false,
		maxRetransmits: 0,
		negotiated: true,
		id: 0
	});

	window.addEventListener("pointermove", (event) => {
		event.preventDefault();
		if (pointerMovementChannel.readyState !== "open") return;

		sharedView.setUint8(0, document.pointerLockElement ? 1 : 0);
		if (document.pointerLockElement) {
			sharedView.setInt32(1, event.movementX, true);
			sharedView.setInt32(5, event.movementY, true);
		} else {
			sharedView.setUint32(1, event.clientX, true);
			sharedView.setUint32(5, event.clientY, true);
		}
		
		pointerMovementChannel.send(sharedBytes.subarray(0, 9));
	});

	const pointerClickChannel = peer.createDataChannel("pointer-click", {
		ordered: true,
		negotiated: true,
		id: 1
	});

	window.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		if (pointerClickChannel.readyState !== "open") return;
		triggerImmersiveMode();

		sharedView.setUint8(0, 1);
		sharedView.setUint8(1, event.button);
		pointerClickChannel.send(sharedBytes.subarray(0, 2));
	});

	window.addEventListener("pointerup", (event) => {
		event.preventDefault();
		if (pointerClickChannel.readyState !== "open") return;

		sharedView.setUint8(0, 0);
		sharedView.setUint8(1, event.button);
		pointerClickChannel.send(sharedBytes.subarray(0, 2));
	});

	const keyboardTypeChannel = peer.createDataChannel("keyboard-type", {
		ordered: true,
		negotiated: true,
		id: 2
	});

	window.addEventListener("keydown", (event) => {
		event.preventDefault();
		if (keyboardTypeChannel.readyState !== "open" || event.repeat) return;
		triggerImmersiveMode();

		if (!(event.code in codeMap)) {
			console.warn(`"${event.code}" does not have a corresponding value in code-map.json`);
			return;
		}

		sharedView.setUint8(0, 1);
		sharedView.setUint8(1, codeMap[event.code]);

		keyboardTypeChannel.send(sharedBytes.subarray(0, 2));
	});

	window.addEventListener("keyup", (event) => {
		event.preventDefault();
		if (keyboardTypeChannel.readyState !== "open") return;

		if (!(event.code in codeMap)) {
			console.warn(`"${event.code}" does not have a corresponding value in code-map.json`);
			return;
		}

		sharedView.setUint8(0, 0);
		sharedView.setUint8(1, codeMap[event.code]);

		keyboardTypeChannel.send(sharedBytes.subarray(0, 2));
	})

	const screenResizeChannel = peer.createDataChannel("screen-resize", {
		ordered: false,
		negotiated: true,
		id: 3
	});

	function onResize() {
		if (screenResizeChannel.readyState !== "open") return;
		console.log("Sending screen resize packet...");

		sharedView.setUint32(0, window.innerWidth, true);
		sharedView.setUint32(4, window.innerHeight, true);
		screenResizeChannel.send(sharedBytes.subarray(0, 8));
	}

	screenResizeChannel.addEventListener("open", onResize);
	window.addEventListener("resize", onResize);

	const pointerScrollChannel = peer.createDataChannel("pointer-scroll", {
		ordered: false,
		maxRetransmits: 0,
		negotiated: true,
		id: 4
	});

	window.addEventListener("wheel", (event) => {
		event.preventDefault();
		if (pointerScrollChannel.readyState !== "open") return;

		sharedView.setUint8(0, event.deltaMode);
		sharedView.setFloat32(1, event.deltaX, true);
		sharedView.setFloat32(5, event.deltaY, true);
		sharedView.setFloat32(9, event.deltaZ, true);
		pointerScrollChannel.send(sharedBytes.subarray(0, 13));
	}, { passive: false });

	// Per-user generated repo (from ensureRepoGenerated during ensureReady)
	const repo = await ensureRepoGenerated(accessToken);
	const repoEndpoint = `https://api.github.com/repos/${repo.full_name}`;
	const headers = {
		"Authorization": `Bearer ${accessToken}`,
		"X-GitHub-Api-Version": "2026-03-10",
		"Content-Type": "application/json",
		"Accept": "application/vnd.github+json"
	};

	const branch = (await (await fetch(repoEndpoint, { headers })).json()).default_branch;
	await fetch(`${repoEndpoint}/actions/workflows/main.yml/dispatches`, {
		"headers": headers,
		"body": JSON.stringify({
			"ref": branch,
			"inputs": {
				"os": os,
				"topic-name": topicName
			}
		}),
		"method": "POST",
	});
})

async function startOAuthFlow(baseUrl) {
    const code_verifier = crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: "base64url", omitPadding: true });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code_verifier));
    const code_challenge = new Uint8Array(digest).toBase64({ alphabet: "base64url", omitPadding: true });

    sessionStorage.setItem("code_verifier", code_verifier);

    const parameters = new URLSearchParams({
        "client_id": CLIENT_ID,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
        "state": crypto.randomUUID(),
    });

    window.location.href = `${baseUrl}?${parameters.toString()}`;
}

// ---- App state (3 states instead of just logged-in/out) ----
function setAppLoggedIn(loggedIn) {
    document.getElementById("logged-out").hidden = loggedIn;
    document.getElementById("logged-in").hidden = !loggedIn;
}

async function clearCookiesLocally() {
	await cookieStore.delete("access_token");
	await cookieStore.delete("refresh_token");
}

async function isAccessTokenValid() {
    const accessToken = (await cookieStore.get("access_token"))?.value;
    if (!accessToken) return false;

    try {
        const response = await fetch("https://api.github.com/user", {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "X-GitHub-Api-Version": "2026-03-10",
                "Accept": "application/vnd.github+json"
            }
        });
        return response.ok;
    } catch (err) {
        console.error("Network error while checking token validity:", err);
    }
    return false;
}

async function isAppInstalled(accessToken) {
    try {
        const res = await fetch("https://api.github.com/user/installations", {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "X-GitHub-Api-Version": "2026-03-10",
                "Accept": "application/vnd.github+json"
            }
        });
        if (!res.ok) return false;
        const data = await res.json();
        return data.total_count > 0;
    } catch (err) {
        console.error("Network error while checking installation:", err);
        return false;
    }
}

// Returns the numeric installation ID for this app, or null if not installed.
async function getInstallationId(accessToken) {
    const res = await fetch("https://api.github.com/user/installations", {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "X-GitHub-Api-Version": "2026-03-10",
            "Accept": "application/vnd.github+json"
        }
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Since ensureReady only redirects to install our own app, and
    // /user/installations lists every app the user has installed, filter
    // to the one whose app_id matches ours. We only know the slug here,
    // so match on app_slug.
    const install = data.installations.find(i => i.app_slug === APP_SLUG);
    return install?.id ?? null;
}

// Checks whether the app's installation currently has access to the given
// repo (by full_name, e.g. "octocat/os-in-browser-runner"). Paginates
// /user/installations/{id}/repositories.
async function installationCoversRepo(accessToken, fullRepoName) {
    const installationId = await getInstallationId(accessToken);
    if (!installationId) return false;

    const headers = {
        "Authorization": `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "Accept": "application/vnd.github+json"
    };

    let page = 1;
    while (true) {
        const res = await fetch(
            `https://api.github.com/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
            { headers }
        );
        if (!res.ok) return false;

        const data = await res.json();
        if (data.repositories.some(r => r.full_name === fullRepoName)) return true;
        if (data.repositories.length < 100) return false;
        page++;
    }
}

async function fetchUser(accessToken) {
    const res = await fetch("https://api.github.com/user", {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "X-GitHub-Api-Version": "2026-03-10",
            "Accept": "application/vnd.github+json"
        }
    });
    return res.ok ? res.json() : null;
}

// Ensures the per-user runner repo exists, generating it from the template
// (via the user's own access token — repo creation for a personal account
// has to go through the user, not the app installation) if it doesn't
// already exist. Returns the repo object ({ id, full_name, ... }) or null
// on failure.
async function ensureRepoGenerated(accessToken) {
    const headers = {
        "Authorization": `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "Accept": "application/vnd.github+json"
    };

    const me = await fetchUser(accessToken);
    if (!me) return null;

    const existing = await fetch(`https://api.github.com/repos/${me.login}/${RUNNER_REPO_NAME}`, { headers });
    if (existing.ok) return existing.json();
    if (existing.status !== 404) return null;

    const generated = await fetch(`https://api.github.com/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
            owner: me.login,
            name: RUNNER_REPO_NAME,
            include_all_branches: false,
            private: false
        })
    });

    return generated.ok ? generated.json() : null;
}

// ---- Central gatekeeper: call this after login AND on every restore ----
// Returns true only when the user has a valid token, their runner repo
// exists, AND the app installation actually has access to that repo.
async function ensureReady() {
    const accessToken = (await cookieStore.get("access_token"))?.value;
    if (!accessToken) {
        setAppLoggedIn(false);
        return false;
    }

    const repo = await ensureRepoGenerated(accessToken);
    if (!repo) {
        // Repo creation failed (rate limit, name collision, network, etc.)
        setAppLoggedIn(false);
        return false;
    }

    const installed = await isAppInstalled(accessToken);
    if (!installed) {
        // Repo already exists at this point, so the install screen can be
        // pre-scoped to it via suggested_target_id + repository_ids[]
        // (documented under "Migrating OAuth Apps to GitHub Apps", but
        // works outside that context too). This is a pre-selection, not
        // an enforced restriction — the user can still change it on that
        // screen, which is why installationCoversRepo below still checks.
        const me = await fetchUser(accessToken);
        const params = new URLSearchParams({ suggested_target_id: me.id });
        params.append("repository_ids[]", repo.id);
        window.location.href =
            `https://github.com/apps/${APP_SLUG}/installations/new/permissions?${params.toString()}`;
        return false;
    }

    const covered = await installationCoversRepo(accessToken, repo.full_name);
    if (!covered) {
        // App is installed, but this specific repo isn't in its granted
        // set (skipped during install, or an install that predates this
        // repo). There's no API path to fix this from a GitHub App user
        // access token (PUT /user/installations/.../repositories/... only
        // works with classic PATs), so send them to the installation's
        // own config page to add it manually.
        const installationId = await getInstallationId(accessToken);
        window.location.href = `https://github.com/settings/installations/${installationId}`;
        return false;
    }

    setAppLoggedIn(true);
    return true;
}

// Session Check — just resolves to a valid token or not; ensureReady() handles the rest
async function restoreSession() {
    if (await isAccessTokenValid()) return true;

    if (!(await cookieStore.get("refresh_token"))) return false;

    try {
        const res = await fetch("/get-access-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ grant_type: "refresh_token" })
        });
        if (res.ok) return true;
    } catch (err) {
        console.warn("Refresh failed:", err);
    }

    await clearCookiesLocally();
    return false;
}

// OAuth Callback — handles both the plain login AND the install-then-authorize redirect
async function handleOAuthCallback() {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return false;

    const code_verifier = sessionStorage.getItem("code_verifier");
    sessionStorage.removeItem("code_verifier");

    const res = await fetch("/get-access-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier })
    });

    history.replaceState(history.state, document.title, location.pathname);
    return res.ok;
}

function triggerImmersiveMode() {	
	if (document.fullscreenEnabled && !document.fullscreenElement) {
		document.body.requestFullscreen({
			"navigationUI": "hide"
		}).then(() => navigator.keyboard?.lock()).catch(() => {});
	};

	if (!document.pointerLockElement) {
		document.body.requestPointerLock({
			"unadjustedMovement": true
		}).catch(() => {});
	}
}