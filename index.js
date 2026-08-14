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

import { Octokit } from "https://esm.sh/@octokit/rest@21?bundle";
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
let username;
try {
	octokit = makeOctokit();
	({ data: { login: username } } = await octokit.rest.users.getAuthenticated());
	document.body.hidden = false;
} catch {
	goToLogInScreen();
}
// --

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

	try {
		await octokit.rest.repos.get({ owner: username, repo: TEMPLATE_REPO });
	} catch {
		await octokit.rest.repos.createUsingTemplate({
			template_owner: TEMPLATE_OWNER,
			template_repo: TEMPLATE_REPO,
			owner: username,
			name: TEMPLATE_REPO,
			include_all_branches: false,
			private: false
		});
	}

	const { data: { default_branch: branch } } = await octokit.rest.repos.get({ owner: username, repo: TEMPLATE_REPO });
	await octokit.rest.actions.createWorkflowDispatch({
		owner: username,
		repo: TEMPLATE_REPO,
		workflow_id: "main.yml",
		ref: branch,
		inputs: { os }
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

// checks api? maybe use tunnel for ice trickle
async function refreshStatuses() {
	let runs;
	try {
		({ data: { workflow_runs: runs } } = await octokit.rest.actions.listWorkflowRunsForRepo({
			owner: username,
			repo: TEMPLATE_REPO,
			status: "in_progress",
			per_page: 100
		}));
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
			({ data: { statuses } } = await octokit.rest.repos.getCombinedStatusForRef({
				owner: username,
				repo: TEMPLATE_REPO,
				ref: sha
			}));
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
	new ClientPeer(wsUrl.toString());
}