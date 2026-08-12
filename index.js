// Pointer lock makes events added to "screenshare" element not work since document.body is the one requesting for pointer lock - a child of "window".
window.addEventListener("error", (event) => {
	const errorMessage = event.message || "Unknown error occurred";
    window.alert(`Error:\n${errorMessage}`);
});

window.addEventListener("unhandledrejection", (event) => {
    const asyncErrorMessage = event.reason?.message || event.reason || "Unknown async error occurred";
    window.alert(`Async error:\n${asyncErrorMessage}`);
});

// Log in handling
const code = new URLSearchParams(location.search).get("code");
if (code) {
	history.replaceState(history.state, document.title, location.pathname);
	await setAccessToken(code);
	// return
}

const etagCache = new Map(); // path -> { etag, data }
let username;
try {
	username = (await gh("GET", "/user")).login;
	document.body.hidden = false;
} catch {
	goToLogInScreen();
}
// --

import createClientPeer from "./createClientPeer.js";

const TEMPLATE_OWNER = "kingdudely";
const TEMPLATE_REPO = "os-in-browser.pages.dev-host";
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

document.getElementById("account-name").textContent = username;
document.getElementById("logout-button").addEventListener("click", logOut);

document.getElementById("start-runner-form").addEventListener("submit", async (event) => {
	event.preventDefault();
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

	const branch = (await gh("GET", repoEndpoint)).default_branch;
	await gh("POST", `${repoEndpoint}/actions/workflows/main.yml/dispatches`, {
		"ref": branch,
		"inputs": {
			"os": os
		}
	});
});

async function gh(method, path, body) {
	const cached = etagCache.get(path);
	const headers = {
		"Authorization": `Bearer ${localStorage.getItem("access_token")}`,
		"Accept": "application/vnd.github+json",
		"Content-Type": "application/json",
	};
	if (method === "GET" && cached) headers["If-None-Match"] = cached.etag;

	const response = await fetch(`https://api.github.com${path}`, {
		"method": method,
		"headers": headers,
		"body": body !== undefined ? JSON.stringify(body) : undefined
	});

	if (response.status === 304) return cached.data;

	if (response.status === 401) logOut();

	const json = await response.json();

	if (!response.ok) {
		throw new Error(`Got HTTP status code ${response.status}${json.message ? `, error message: ${json.message}` : ""}`);
	}

	const etag = response.headers.get("ETag");
	if (method === "GET" && etag) etagCache.set(path, { etag, data: json });

	return json;
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
	const repoEndpoint = `/repos/${username}/${TEMPLATE_REPO}`;

	let repo, sha;
	try {
		repo = await gh("GET", repoEndpoint);
		sha = (await gh("GET", `${repoEndpoint}/commits/${repo.default_branch}`)).sha;
	} catch {
		return; // repo/branch not there yet
	}

	const { statuses } = await gh("GET", `${repoEndpoint}/commits/${sha}/status`);
	statuses.forEach(renderStatus);
}

function renderStatus(status) {
	let row = rows.get(status.context);
	if (!row) {
		row = runnerListEntryTemplate.content.firstElementChild.cloneNode(true);
		row.querySelector(".connect-button").addEventListener("click", () => connect(row));
		rows.set(status.context, row);
		runnerList.appendChild(row);
	}

	row._status = status;
	row.querySelector(".created-at").textContent = new Date(status.created_at).toLocaleString();
	row.querySelector(".os").textContent = status.description || "unknown";
}

function connect(row) {
	const wsUrl = new URL(row._status.target_url);
	wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
	createClientPeer(wsUrl.toString());
}