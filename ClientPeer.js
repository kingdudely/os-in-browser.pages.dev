import codeMap from "./code-map.json" with { type: "json" };

const sharedBytes = new Uint8Array(13);
const sharedView = new DataView(sharedBytes.buffer);
const screenshare = document.getElementById("screenshare");
const mainContainer = document.getElementById("main-container");
let pointerMovementChannel, pointerClickChannel, keyboardTypeChannel, pointerScrollChannel;

export default class ClientPeer extends RTCPeerConnection {
	static Init = {
		iceServers: [
			{ urls: "stun:stun.l.google.com:19302" }
		]
	};

	signalingWs;

	constructor (signalingUrl) {
		// Pointer lock makes events added to "screenshare" element not work since document.body is the one requesting for pointer lock - a child of "window".
		super(ClientPeer.Init);
		this.signalingWs = new WebSocket(signalingUrl, [localStorage.getItem("access_token")]);
		const pingInterval = setInterval(() => this.#sendWSMessage("ping"), 1337);
		this.signalingWs.addEventListener("close", () => clearInterval(pingInterval));

		this.addEventListener("track", ClientPeer.#OnTrack.bind(ClientPeer));
		this.addEventListener("connectionstatechange", this.#onConnectionStateChange.bind(this));
		this.addEventListener("icecandidate", this.#onICECandidate.bind(this));

		this.addTransceiver("video", {
			direction: "recvonly"
		});

		this.#initializeDataChannels();
		this.signalingWs.addEventListener("message", this.#onTrickleICEMessage.bind(this));

		ClientPeer.#SetRemoteControlMode(true);
	}

	#initializeDataChannels() {
		pointerMovementChannel = this.createDataChannel("pointer-movement", {
			ordered: false,
			maxRetransmits: 0,
			negotiated: true,
			id: 0
		});

		pointerClickChannel = this.createDataChannel("pointer-click", {
			ordered: true,
			negotiated: true,
			id: 1
		});

		pointerScrollChannel = this.createDataChannel("pointer-scroll", {
			ordered: false,
			maxRetransmits: 0,
			negotiated: true,
			id: 2
		});

		keyboardTypeChannel = this.createDataChannel("keyboard-type", {
			ordered: true,
			negotiated: true,
			id: 3
		});
	}

	#onConnectionStateChange() {
		switch (this.connectionState) {
			case "failed": {
				window.alert("Connection to the remote desktop failed, retrying connection...");
				this.restartIce();
				break;
			};

			case "disconnected": {
				window.alert("Disconnected from the remote desktop, retrying connection...");
				break;
			}

			case "closed": {
				window.alert("Remote desktop connection was closed.");
				this.signalingWs.close();
				ClientPeer.#SetRemoteControlMode(false);
				break;
			};

			default: {
				console.warn(`Unknown connection state: ${this.connectionState}`);
				break;
			}
		}
	}

	#onICECandidate(event) {
		if (event.candidate) this.#sendWSMessage("ice-candidate", event.candidate);
	}

	async #onTrickleICEMessage(event) {
		let data;
		try { data = JSON.parse(event.data); } catch { return; }

		switch (data.type) {
			case "offer": {
				await this.setRemoteDescription(data.message);
				const answer = await this.createAnswer();
				await this.setLocalDescription(answer);
				this.#sendWSMessage("answer", this.localDescription);
				break;
			}

			case "ice-candidate": {
				await this.addIceCandidate(data.message);
				break;
			}

			case "ping": break;

			default: {
				console.warn(`Unknown packet type: ${data.type}`);
				break;
			}
		}
	}

	#sendWSMessage(type, message) {
		if (this.signalingWs.readyState === WebSocket.OPEN) {
			this.signalingWs.send(JSON.stringify({ type, message }));
		}
	}

	static #OnTrack(event) {
		screenshare.srcObject = event.streams[0];
		screenshare.play().catch(console.warn);
	}

	static #SetRemoteControlMode(isInRemoteControlMode) {
		mainContainer.hidden = isInRemoteControlMode;
		screenshare.hidden = !isInRemoteControlMode;
	}
}

window.addEventListener("onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove", onPointerMove);
window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointerup", onPointerUp);

window.addEventListener("keydown", onKeyDown); // Could do tabindex=0 but then they can just press tab again - also, this is more reliable, and screenshare is basically the whole screen anyways.
window.addEventListener("keyup", onKeyUp);

window.addEventListener("wheel", onScroll);

function onPointerMove(event) {
	if (pointerMovementChannel?.readyState !== "open") return;
	event.preventDefault();

	sharedView.setUint8(0, document.pointerLockElement ? 1 : 0);
	if (document.pointerLockElement) {
		sharedView.setInt32(1, event.movementX, true);
		sharedView.setInt32(5, event.movementY, true);
	} else {
		sharedView.setUint32(1, event.clientX, true);
		sharedView.setUint32(5, event.clientY, true);
	}
	
	pointerMovementChannel.send(sharedBytes.subarray(0, 9));
}

function onPointerUp(event) {
	return onPointerButtonEvent(false, event);
};

function onPointerDown(event) {
	return onPointerButtonEvent(true, event);
};

function onKeyUp(event) {
	return onKeyButtonEvent(false, event);
}

function onKeyDown(event) {
	return onKeyButtonEvent(true, event);
}

function onPointerButtonEvent(isDown, event) {
	if (pointerClickChannel?.readyState !== "open") return;
	event.preventDefault();

	if (isDown) triggerImmersiveMode();

	sharedView.setUint8(0, isDown ? 1 : 0); // isDown
	sharedView.setUint8(1, event.button);
	pointerClickChannel.send(sharedBytes.subarray(0, 2));
}

function onKeyButtonEvent(isDown, event) {
	if (keyboardTypeChannel?.readyState !== "open" || event.repeat) return;
	event.preventDefault();

	if (isDown) triggerImmersiveMode();

	if (!(event.code in codeMap)) {
		console.warn(`"${event.code}" does not have a corresponding value in code-map.json`);
		return;
	}

	sharedView.setUint8(0, isDown ? 1 : 0); // isDown
	sharedView.setUint8(1, codeMap[event.code]);

	keyboardTypeChannel.send(sharedBytes.subarray(0, 2));
}

function onScroll(event) {
	if (pointerScrollChannel?.readyState !== "open") return;
	event.preventDefault();

	sharedView.setUint8(0, event.deltaMode);
	sharedView.setFloat32(1, event.deltaX, true);
	sharedView.setFloat32(5, event.deltaY, true);
	sharedView.setFloat32(9, event.deltaZ, true); // unsupported in pynput
	pointerScrollChannel.send(sharedBytes.subarray(0, 13));
}

// try catch not just catch() because what if the member doesn't exist?
async function triggerImmersiveMode() {
	if (!document.pointerLockElement) {
		try {
			await document.body.requestPointerLock({ unadjustedMovement: true });
		} catch {};
	}

	if (document.fullscreenEnabled && !document.fullscreenElement) {
		try {
			await document.body.requestFullscreen({ navigationUI: "hide", keyboardLock: "browser" });
		} catch {}

		try {
			await navigator.keyboard.lock();
		} catch {}
	}
}