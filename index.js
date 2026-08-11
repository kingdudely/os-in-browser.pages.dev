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
	await setAccessToken(code);
	// return
}

const user = await gh("GET", "/user");
setLoggedInUIState(true);

const TEMPLATE_OWNER = "kingdudely";
const TEMPLATE_REPO = "os-in-browser.pages.dev-host";

const startRunnerDialog = document.getElementById("start-runner-dialog");
document.getElementById("open-start-runner-dialog").addEventListener("click", () => startRunnerDialog.showModal());
document.getElementById("close-start-runner-dialog").addEventListener("click", () => startRunnerDialog.close())

document.getElementById("start-runner-form").addEventListener("submit", async (event) => {
	// event.preventDefault();
	// mainDialog.close();

	const formData = new FormData(event.target);
	const os = formData.get("os");

	const owner = (await gh("/user", { headers })).json()).login;

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
});

async function gh(method, path, body) {
	const response = await fetch(`https://api.github.com${path}`, {
		"method": method,
		"headers": {
			"Authorization": `Bearer ${localStorage.getItem("access_token")}`,
			"Accept": "application/vnd.github+json",
			"Content-Type": "application/json",
			// browser sets useragent for us
		},
		"body": JSON.stringify(body)
	});

	const json = response.json();

	if (response.status === 401) {
		await logOut();
	}

	if (!response.ok) {
		throw new Error(`Got status code ${response.status}${json.message ? `, error message: ${json.message}` : ""}`);
	}

	return json;
}

async function setAccessToken(code) {
	const accessToken = (await (await fetch("/get-access-token", {
		"method": "POST",
		"body": code
	})).json()).access_token;

	localStorage.setItem("access_token", accessToken)
}

async function logOut() {
	const accessToken = localStorage.getItem("access_token");
	localStorage.remoteItem("access_token");
	setLoggedInUIState(false);

	await fetch("/delete-access-token", {
		"method": "POST",
		"body": accessToken
	})
}

function setLoggedInUIState(loggedIn) {
	document.getElementById("logout").hidden = loggedIn;
	document.getElementById("login").hidden = !loggedIn;
}