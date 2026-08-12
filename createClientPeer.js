import codeMap from "./code-map.json" with { type: "json" };

const screenshare = document.getElementById("screenshare");
const mainContainer = document.getElementById("main-container");
const sharedBytes = new Uint8Array(13);
const sharedView = new DataView(sharedBytes.buffer);
const pointerMoveEventName = "onpointerrawupdate" in window ? "onpointerrawupdate" : "onpointermove";
const RTCPeerConnectionInit = {
	iceServers: [
		{ urls: "stun:stun.l.google.com:19302" }
	]
};

export default function createClientPeer(signalingUrl) {
	// Pointer lock makes events added to "screenshare" element not work since document.body is the one requesting for pointer lock - a child of "window".

	const peer = new RTCPeerConnection(RTCPeerConnectionInit);
	peer.addEventListener("track", onTrack);
	
	peer.addEventListener("connectionstatechange", () => {
		if (["disconnected", "closed"].includes(peer.connectionState)) {
			setRemoteControlMode(false);
		}
	})

	peer.addTransceiver("video", {
		direction: "recvonly"
	});

	const pointerMovementChannel = peer.createDataChannel("pointer-movement", {
		ordered: false,
		maxRetransmits: 0,
		negotiated: true,
		id: 0
	});

	const pointerClickChannel = peer.createDataChannel("pointer-click", {
		ordered: true,
		negotiated: true,
		id: 1
	});

	const keyboardTypeChannel = peer.createDataChannel("keyboard-type", {
		ordered: true,
		negotiated: true,
		id: 2
	});

	const screenResizeChannel = peer.createDataChannel("screen-resize", {
		ordered: false,
		negotiated: true,
		id: 3
	});

	const pointerScrollChannel = peer.createDataChannel("pointer-scroll", {
		ordered: false,
		maxRetransmits: 0,
		negotiated: true,
		id: 4
	});

	// pointerrawupdate, getCoalescedEvents
	window[pointerMoveEventName] = onPointerMove.bind(pointerMovementChannel);
	window.onpointerdown = onPointerButtonEvent.bind(pointerClickChannel, true);
	window.onpointerup = onPointerButtonEvent.bind(pointerClickChannel, false);

	window.onkeydown = onKeyButtonEvent.bind(keyboardTypeChannel, true); // Could do tabindex=0 but then they can just press tab again - also, this is more reliable, and screenshare is basically the whole screen anyways.
	window.onkeyup = onKeyButtonEvent.bind(keyboardTypeChannel, false);

	screenResizeChannel.addEventListener("open", onResize.bind(screenResizeChannel)); // So it automatically resizes in the beginning
	window.onresize = onResize.bind(screenResizeChannel); // ResizeObserver 
	window.onwheel = onScroll.bind(pointerScrollChannel);

	const ws = new WebSocket(signalingUrl);

	function send(type, message) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type, message }));
		}
	}

	ws.addEventListener("open", () => {
		ws.send(localStorage.getItem("access_token")); // raw, matches server's ws.once('message', ...) handshake
	});

	peer.addEventListener("icecandidate", (event) => {
		if (event.candidate) send("ice-candidate", event.candidate);
	});

	ws.addEventListener("message", async (event) => {
		let data;
		try { data = JSON.parse(event.data); } catch { return; }

		switch (data.type) {
			case "offer":
				try {
					await peer.setRemoteDescription(data.message);
					const answer = await peer.createAnswer();
					await peer.setLocalDescription(answer);
					send("answer", peer.localDescription);
				} catch (err) {
					console.error("Failed to handle offer:", err);
				}
				break;
			case "ice-candidate":
				try { await peer.addIceCandidate(data.message); }
				catch (err) { console.error("Failed to add ICE candidate:", err); }
				break;
		}
	});

	setRemoteControlMode(true);

	return peer;
}

function onTrack(event) {
	screenshare.srcObject = event.streams[0];
	screenshare.play().catch(console.warn);
}

function onPointerMove(event) {
	event.preventDefault();
	if (this.readyState !== "open") return;

	sharedView.setUint8(0, document.pointerLockElement ? 1 : 0);
	if (document.pointerLockElement) {
		sharedView.setInt32(1, event.movementX, true);
		sharedView.setInt32(5, event.movementY, true);
	} else {
		sharedView.setUint32(1, event.clientX, true);
		sharedView.setUint32(5, event.clientY, true);
	}
	
	this.send(sharedBytes.subarray(0, 9));
}

function onPointerButtonEvent(isDown, event) {
	event.preventDefault();
	if (this.readyState !== "open") return;
	if (isDown) triggerImmersiveMode();

	sharedView.setUint8(0, isDown ? 1 : 0); // isDown
	sharedView.setUint8(1, event.button);
	this.send(sharedBytes.subarray(0, 2));
}

function onKeyButtonEvent(isDown, event) {
	event.preventDefault();
	if (this.readyState !== "open" || event.repeat) return;
	if (isDown) triggerImmersiveMode();

	if (!(event.code in codeMap)) {
		console.warn(`"${event.code}" does not have a corresponding value in code-map.json`);
		return;
	}

	sharedView.setUint8(0, isDown ? 1 : 0); // isDown
	sharedView.setUint8(1, codeMap[event.code]);

	this.send(sharedBytes.subarray(0, 2));
}

function onResize(event /* unused */) {
	if (this.readyState !== "open") return;
	console.log("Sending screen resize packet...");

	sharedView.setUint32(0, window.innerWidth, true);
	sharedView.setUint32(4, window.innerHeight, true);
	this.send(sharedBytes.subarray(0, 8));
}

function onScroll(event) {
	event.preventDefault();
	if (this.readyState !== "open") return;

	sharedView.setUint8(0, event.deltaMode);
	sharedView.setFloat32(1, event.deltaX, true);
	sharedView.setFloat32(5, event.deltaY, true);
	sharedView.setFloat32(9, event.deltaZ, true); // unsupported in pynput
	this.send(sharedBytes.subarray(0, 13));
}

function triggerImmersiveMode() {	
	if (document.fullscreenEnabled && !document.fullscreenElement) {
		document.body.requestFullscreen({ // target, await
			"navigationUI": "hide"
		}).then(() => navigator.keyboard?.lock()).catch(() => {});
	};

	if (!document.pointerLockElement) {
		document.body.requestPointerLock({ // target, await
			"unadjustedMovement": true
		}).catch(() => {});
	}
}

function setRemoteControlMode(isInRemoteControlMode) {
	mainContainer.hidden = isInRemoteControlMode;
	screenshare.hidden = !isInRemoteControlMode;
}