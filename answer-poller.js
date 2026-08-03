const sleep = (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds));

self.addEventListener("message", async (event) => {
	const { repoEndpoint, headers, workflowRunId } = event.data;

	while (true) {
		try {
			const { artifacts } = await (await fetch(`${repoEndpoint}/actions/runs/${workflowRunId}/artifacts`, { headers })).json();
			const answerDownloadUrl = artifacts?.find((artifact) => artifact.name === "answer.txt")?.archive_download_url;

			if (answerDownloadUrl) {
				self.postMessage({ answerDownloadUrl });
				break;
			}
		} catch (error) {
			console.warn("poll failed, retrying:", error);
		}

		await sleep(1000);
	}
});