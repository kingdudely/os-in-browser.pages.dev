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
const repoEndpoint = `/repos/${username}/${TEMPLATE_REPO}`;

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

// checks api? maybe use tunnel for ice trickle
async function refreshStatuses() {
	let runs;
	try {
		({ workflow_runs: runs } = await gh(
			"GET",
			`${repoEndpoint}/actions/runs?status=in_progress&per_page=100`
		));
	} catch {
		return;
	}

	const activeIds = new Set(runs.map((run) => run.id));

	for (const [id, row] of rows) {
		if (!activeIds.has(id)) {
			row.remove();
			rows.delete(id);
		}
	}

	// multiple in-progress runs often share the same head_sha (no new commits
	// between dispatches) — group by sha so each commit is only fetched once
	const runsBySha = new Map();
	for (const run of runs) {
		if (!runsBySha.has(run.head_sha)) runsBySha.set(run.head_sha, []);
		runsBySha.get(run.head_sha).push(run);
	}

	await Promise.all([...runsBySha].map(async ([sha, runsForSha]) => {
		let statuses;
		try {
			({ statuses } = await gh("GET", `${repoEndpoint}/commits/${sha}/status`));
		} catch {
			return;
		}

		for (const run of runsForSha) {
			// backend posts each run's status with context = that run's own id
			const status = statuses.find((s) => s.context === String(run.id));
			if (status) renderStatus(run, status);
		}
	}));
}

function renderStatus(run, status) {
	let row = rows.get(run.id);
	if (!row) {
		row = runnerListEntryTemplate.content.firstElementChild.cloneNode(true);
		row.querySelector(".connect-button").addEventListener("click", () => connect(row));
		rows.set(run.id, row);
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