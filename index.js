// Pointer lock makes events added to "screenshare" element not work since document.body is the one requesting for pointer lock - a child of "window".
window.addEventListener("error", (event) => {
	const errorMessage = event.message || "Unknown error occurred";
    window.alert(`Error:\n${errorMessage}`);
});

window.addEventListener("unhandledrejection", (event) => {
    const asyncErrorMessage = event.reason?.message || event.reason || "Unknown async error occurred";
    window.alert(`Async error:\n${asyncErrorMessage}`);
});

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
		navigator.wakeLock?.request('screen');
	}
});

const code = new URLSearchParams(location.search).get("code");
if (code) {
	history.replaceState(history.state, document.title, location.pathname);
	const oauth = document.getElementById("oauth");
	oauth.code.value = code;
	oauth.requestSubmit(document.getElementById("download-access-token"));
	// return
}

const TEMPLATE_OWNER = "kingdudely";
const TEMPLATE_REPO = "os-in-browser.pages.dev-host";

document.getElementById("start-runner").addEventListener("submit", async (event) => {
	// event.preventDefault();
	// mainDialog.close();

	const formData = new FormData(event.target);
	const os = formData.get("os");
	const credentialFile = formData.get("credential-file");
	if (!credentialFile) return;

	const accessToken = new URLSearchParams(await credentialFile.text()).get("access_token");
	if (!accessToken) {
		alert("Invalid credential file");
		return;
	}

	const headers = {
		"Authorization": `token ${accessToken}`,
		"Content-Type": "application/json"
	};

	const owner = (await (await fetch("https://api.github.com/user", { headers })).json()).login;

	const repoEndpoint = `https://api.github.com/repos/${owner}/${TEMPLATE_REPO}`;
	const existingRepoResponse = await fetch(repoEndpoint, { headers });

	if (existingRepoResponse.status === 404) {
		// User doesn't have the host repo yet — generate one from the template.
		const generateResponse = await fetch(`https://api.github.com/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`, {
			headers,
			method: "POST",
			body: JSON.stringify({
				"owner": owner,
				"name": TEMPLATE_REPO,
				"include_all_branches": false,
				"private": false
			}),
		});

		if (!generateResponse.ok) {
			throw new Error(`Failed to generate repo from template: ${generateResponse.status} ${await generateResponse.text()}`);
		}
	} else if (!existingRepoResponse.ok) {
		throw new Error(`Failed to check for existing repo: ${existingRepoResponse.status} ${await existingRepoResponse.text()}`);
	}

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