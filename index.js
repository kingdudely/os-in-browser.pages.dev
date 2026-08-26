// Mobile support: tap start is absolute position, then moving is relative - add clipboard support - fix screen resize
// window.addEventListener('paste', navigator.clipboard.addEventListener("clipboardchange", import clipboardy from 'clipboardy';, const { clipboard } = require('electron');

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
let username;
try {
	octokit = makeOctokit();
	username = (await octokit.rest.users.getAuthenticated()).data.login;
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

document.getElementById("account-name").textContent = username;
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
			"owner": username,
			"repo": TEMPLATE_REPO
		})).data.default_branch;
	} catch {
		branch = (await octokit.rest.repos.createUsingTemplate({
			"template_owner": TEMPLATE_OWNER,
			"template_repo": TEMPLATE_REPO,
			"owner": username,
			"name": TEMPLATE_REPO,
			"include_all_branches": false,
			"private": false
		})).data.default_branch;
	}

	await dispatchWithRetry(branch, os);
	optionalRockPaperScissors();
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
	let runs;
	try {
		runs = (await octokit.rest.actions.listWorkflowRunsForRepo({
			"owner": username,
			"repo": TEMPLATE_REPO,
			"status": "in_progress",
			"per_page": 20
		})).data.workflow_runs;
	} catch {
		return;
	}

	const seenIds = new Set(runs.map(r => r.id));

	for (const run of runs) {
		if (rows.has(run.id)) continue;
		rows.set(run.id, null); // claim it immediately, synchronously
		newRunEntry(run).then((row) => {
			if (!row) { rows.delete(run.id); return; }
			rows.set(run.id, row);
			runnerList.appendChild(row);
		});
	}

	for (const [id, row] of rows) {
		if (!seenIds.has(id) && row) {
			row.remove();
			rows.delete(id);
		}
	}
}

async function newRunEntry(run) {
	let tunnelUrl, osName;
	const [artifactsResult, jobsResult] = await Promise.allSettled([
		octokit.request(run.artifacts_url),
		octokit.request(run.jobs_url)
	]);

	if (artifactsResult.status === "fulfilled") tunnelUrl = artifactsResult.value.data.artifacts[0]?.name;
	if (jobsResult.status === "fulfilled") osName = jobsResult.value.data.jobs[0]?.labels[0];

	if (!tunnelUrl) return;

	const row = runnerListEntryTemplate.content.firstElementChild.cloneNode(true);
	row.querySelector(".connect-button").addEventListener("click", () => new ClientPeer(`wss://${tunnelUrl}`));
	row.querySelector(".created-at").textContent = new Date(run.created_at).toLocaleString();
	row.querySelector(".os").textContent = osName || "unknown";
	return row;
}

async function dispatchWithRetry(branch, os) {
	const warnTimer = setTimeout(() => window.alert("This is taking a lot longer than usual to start..."), 15000);

	while (true) {
		try {
			await octokit.rest.actions.createWorkflowDispatch({
				"owner": username,
				"repo": TEMPLATE_REPO,
				"workflow_id": "main.yml",
				"ref": branch,
				"inputs": { "os": os }
			});

			clearTimeout(warnTimer);

			break;
		} catch (error) {
			if (error.status !== 404) {
				clearTimeout(warnTimer);
				throw error;
			}

			await sleep(1000);
		}
	}
}

function optionalRockPaperScissors() {
	if (!confirm("Your OS is starting, it might take some time to boot. Want to play rock paper scissors while you wait?")) return;

	const choices = ["rock", "paper", "scissors"];
	const beats = {
		"rock": "scissors",
		"paper": "rock",
		"scissors": "paper"
	};
	let wins = 0, losses = 0, ties = 0;

	while (true) {
		const input = prompt(`Rock, paper, or scissors? (${wins}W-${losses}L-${ties}T)\nType "rock", "paper", or "scissors". Cancel to stop.`);
		if (input === null) break; // user hit cancel

		const playerChoice = input.trim().toLowerCase();
		if (!choices.includes(playerChoice)) {
			alert(`"${playerChoice}" isn't a valid move. Try again.`);
			continue;
		}

		const computerChoice = choices[Math.floor(Math.random() * 3)].trim().toLowerCase();
		let result;
		if (playerChoice === computerChoice) {
			result = "Tie!";
			ties++;
		} else if (beats[playerChoice] === computerChoice) {
			result = "You win!";
			wins++;
		} else {
			result = "You lose!";
			losses++;
		}

		alert(`You: ${playerChoice}\nComputer: ${computerChoice}\n${result}`);
	}
}

function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, 1000));
}
