// Mobile support: tap start is absolute position, then moving is relative - add clipboard support - fix screen resize

// Pointer lock makes events added to "screenshare" element not work since document.body is the one requesting for pointer lock - a child of "window".
window.addEventListener("error", (event) => {
	const errorMessage = event.message || "Unknown error occurred";
    window.alert(`Error:\n${errorMessage}`);
});

window.addEventListener("unhandledrejection", (event) => {
    const asyncErrorMessage = event.reason?.message || event.reason || "Unknown async error occurred";
    window.alert(`Async error:\n${asyncErrorMessage}`);
});

import { Octokit } from "https://esm.sh/@octokit/rest?bundle";
import { createCallbackAuth } from "https://esm.sh/@octokit/auth-callback?bundle";
import ClientPeer from "./ClientPeer.js";

// Log in handling
const code = new URLSearchParams(location.search).get("code");
if (code) {
	history.replaceState(history.state, document.title, location.pathname);
	await setAccessToken(code);
	// return
}

let octokit;
let owner;
try {
	octokit = makeOctokit();
	owner = (await octokit.rest.users.getAuthenticated()).data.login;
	document.body.hidden = false;
} catch {
	goToLogInScreen();
}
// --

const TEMPLATE_OWNER = "kingdudely";
const TEMPLATE_REPO = "os-in-browser.pages.dev-template";

const rows = new Map();
const runnerList = document.getElementById("runner-list");
const runnerListEntryTemplate = document.getElementById("runner-list-entry");

refreshStatuses();
setInterval(refreshStatuses, 1000);

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
		navigator.wakeLock?.request('screen');
	}
});

document.getElementById("account-name").textContent = owner;
document.getElementById("logout-button").addEventListener("click", logOut);

// maybe const repo = localStorage.getItem("runner_repo") || crypto.randomUUID()?
document.getElementById("start-runner-form").addEventListener("submit", async (event) => {
	event.preventDefault();
	// mainDialog.close();

	const formData = new FormData(event.target);
	const os = formData.get("os");

	let branch;

	try {
		branch = (await octokit.rest.repos.get({
			"owner": owner,
			"repo": TEMPLATE_REPO
		})).data.default_branch;
	} catch {
		branch = (await octokit.rest.repos.createUsingTemplate({
			"template_owner": TEMPLATE_OWNER,
			"template_repo": TEMPLATE_REPO,
			"owner": owner,
			"name": TEMPLATE_REPO,
			"include_all_branches": false,
			"private": false
		})).data.default_branch;
	}

	await octokit.rest.actions.createWorkflowDispatch({
		"owner": owner,
		"repo": TEMPLATE_REPO,
		"workflow_id": "main.yml",
		"ref": branch,
		"inputs": { "os": os }
	});
});

function makeOctokit() {
	const client = new Octokit({
		authStrategy: createCallbackAuth,
		auth: {
			callback: () => localStorage.getItem("access_token"),
		},
	});

	const etagCache = new Map();
	const dataCache = new Map();

	client.hook.before("request", (options) => {
		if ((options.method || "GET").toUpperCase() !== "GET") return;
		const { url } = client.request.endpoint(options);
		const etag = etagCache.get(url);
		if (etag) options.headers["if-none-match"] = etag;
	});

	client.hook.after("request", (response, options) => {
		if ((options.method || "GET").toUpperCase() !== "GET") return;
		const { url } = client.request.endpoint(options);
		if (response.headers?.etag) {
			etagCache.set(url, response.headers.etag);
			dataCache.set(url, response);
		}
	});

	client.hook.error("request", (error, options) => {
		const { url } = client.request.endpoint(options);
		if (error.status === 304 && dataCache.has(url)) return dataCache.get(url);
		if (error.status === 401) logOut();
		throw error;
	});

	return client;
}

async function setAccessToken(code) {
	const accessToken = (await (await fetch("/get-access-token", {
		"method": "POST",
		"body": code
	})).json()).access_token;

	localStorage.setItem("access_token", accessToken)
}

function logOut() {
	const accessToken = localStorage.getItem("access_token");
	if (accessToken) navigator.sendBeacon("/delete-access-token", accessToken);
	localStorage.removeItem("access_token");
	goToLogInScreen();
}

function goToLogInScreen() {
	const parameters = new URLSearchParams({
		"client_id": "Ov23lipwX2GRkJRc0FdF",
		"prompt": "select_account",
		"scope": "public_repo workflow"
	});

	location.href = `https://github.com/login/oauth/authorize?${parameters.toString()}`;
}

async function refreshStatuses() {
	runnerList.replaceChildren();

	const repo = localStorage.getItem("runner_repo");
	if (!repo) return;

	let runs;
	try {
		runs = (await octokit.rest.actions.listWorkflowRunsForRepo({
			owner,
			repo,
			status: "in_progress",
			per_page: 20
		})).data.workflow_runs;
	} catch {
		return;
	}

	await Promise.all(runs.map(async (run) => {
		let tunnelUrl;
		try {
			tunnelUrl = (await octokit.request(run.artifacts_url)).data.artifacts[0]?.name;
		} catch {
			return;
		}
		if (!tunnelUrl) return;

		const row = runnerListEntryTemplate.content.firstElementChild.cloneNode(true);
		row.querySelector(".connect-button").addEventListener("click", () => new ClientPeer(`wss://${tunnelUrl}`));
		row.querySelector(".created-at").textContent = new Date(run.created_at).toLocaleString();
		row.querySelector(".os").textContent = run.name || "unknown";
		runnerList.appendChild(row);
	}));
}