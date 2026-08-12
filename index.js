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

const TEMPLATE_OWNER = "kingdudely";
const TEMPLATE_REPO = "os-in-browser.pages.dev-host";

const username = (await gh("GET", "/user")).login;

document.getElementById("account-name").textContent = username;
document.getElementById("logout-button").addEventListener("click", logOut);

const startRunnerDialog = document.getElementById("start-runner-dialog");
document.getElementById("open-start-runner-dialog").addEventListener("click", () => startRunnerDialog.showModal());
document.getElementById("close-start-runner-dialog").addEventListener("click", () => startRunnerDialog.close());

document.getElementById("start-runner-form").addEventListener("submit", async (event) => {
	// event.preventDefault();
	// mainDialog.close();

	const formData = new FormData(event.target);
	const os = formData.get("os");

	const repoEndpoint = `/repos/${username}/${TEMPLATE_REPO}`;
	try {
		await gh("GET", repoEndpoint);
	} catch {
		await gh("POST", `/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`, {
			"owner": username,
			"name": TEMPLATE_REPO,
			"include_all_branches": false,
			"private": false
		});
	}

	const branch = (await gh(repoEndpoint)).default_branch;
	await gh("POST", `${repoEndpoint}/actions/workflows/main.yml/dispatches`, {
		"ref": branch,
		"inputs": {
			"os": os
		}
	});
});

setLoggedInUIState(true);

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
		throw new Error(`Got HTTP status code ${response.status}${json.message ? `, error message: ${json.message}` : ""}`);
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
	localStorage.removeItem("access_token");
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