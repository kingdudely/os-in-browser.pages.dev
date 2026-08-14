import codeMap from "./code-map.json" with { type: "json" };

let pointerMovementChannel, pointerClickChannel, keyboardTypeChannel, screenResizeChannel, pointerScrollChannel;
export default class ClientPeer {
	static #Init = {
		iceServers: [
			{ urls: "stun:stun.l.google.com:19302" }
		]
	};

	static #Screenshare = document.getElementById("screenshare");
	static #MainContainer = document.getElementById("main-container");
	static #SharedBytes = new Uint8Array(13);
	static #SharedView = new DataView(sharedBytes.buffer);

	constructor (signalingUrl) {
		// Pointer lock makes events added to "screenshare" element not work since document.body is the one requesting for pointer lock - a child of "window".
		super(ClientPeer.#Init);
		this.signalingWs = new WebSocket(signalingUrl);
		this.signalingWs.addEventListener("open", () => {
			this.signalingWs.send(localStorage.getItem("access_token")); // raw, matches server's ws.once('message', ...) handshake
		});

		this.addEventListener("track", ClientPeer.#OnTrack.bind(ClientPeer));
		this.addEventListener("connectionstatechange", this.#OnConnectionStateChange.bind(this));
		this.addEventListener("icecandidate", this.#OnICECandidate.bind(this));

		this.addTransceiver("video", {
			direction: "recvonly"
		});

		this.#InitializeDataChannels();
		this.signalingWs.addEventListener("message", this.#OnTrickleICEMessage.bind(this));

		ClientPeer.#SetRemoteControlMode(true);
	}

	#InitializeDataChannels() {
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

		keyboardTypeChannel = this.createDataChannel("keyboard-type", {
			ordered: true,
			negotiated: true,
			id: 2
		});

		screenResizeChannel = this.createDataChannel("screen-resize", {
			ordered: false,
			negotiated: true,
			id: 3
		});

		pointerScrollChannel = this.createDataChannel("pointer-scroll", {
			ordered: false,
			maxRetransmits: 0,
			negotiated: true,
			id: 4
		});

		screenResizeChannel.addEventListener("open", onResize); // So it automatically resizes in the beginning 
	}

	#OnConnectionStateChange() {
		switch (this.connectionState) {
			case "failed": {
				window.alert("Connection to the remote desktop failed, retrying connection...");
				this.restartIce();
			};

			case "disconnected": {
				window.alert("Disconnected from the remote desktop, retrying connection...");
				break;
			}

			case "closed": {
				window.alert("Remote desktop connection was closed.");
				ClientPeer.#SetRemoteControlMode(false);
				break;
			};

			default: {
				console.warn(`Unknown connection state: ${this.connectionState}`)
			}
		}
	}

	#OnICECandidate(event) {
		if (event.candidate) this.#SendWSMessage("ice-candidate", event.candidate);
	}

	#OnTrickleICEMessage(event) {
		let data;
		try { data = JSON.parse(event.data); } catch { return; }

		switch (data.type) {
			case "offer":
				try {
					await this.setRemoteDescription(data.message);
					const answer = await this.createAnswer();
					await this.setLocalDescription(answer);
					this.#SendWSMessage("answer", this.localDescription);
				} catch (err) {
					console.error("Failed to handle offer:", err);
				}
				break;
			case "ice-candidate":
				try { await this.addIceCandidate(data.message); }
				catch (err) { console.error("Failed to add ICE candidate:", err); }
				break;
		}
	}

	#SendWSMessage(type, message) {
		if (this.signalingWs.readyState === WebSocket.OPEN) {
			this.signalingWs.send(JSON.stringify({ type, message }));
		}
	}

	static #OnTrack(event) {
		this.#Screenshare.srcObject = event.streams[0];
		this.#Screenshare.play().catch(console.warn);
	}

	static #TriggerImmersiveMode() {	
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

	static #SetRemoteControlMode(isInRemoteControlMode) {
		this.#MainContainer.hidden = isInRemoteControlMode;
		this.#Screenshare.hidden = !isInRemoteControlMode;
	}
}

window.addEventListener("onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove", onPointerMove);
window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointerup", onPointerUp);

window.addEventListener("keydown", onKeyDown); // Could do tabindex=0 but then they can just press tab again - also, this is more reliable, and screenshare is basically the whole screen anyways.
window.addEventListener("keyup", onKeyUp);

window.addEventListener("resize", onResize); // ResizeObserver 
window.addEventListener("wheel", onScroll);

function onPointerMove(event) {
	event.preventDefault();
	if (pointerMovementChannel?.readyState !== "open") return;

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
	event.preventDefault();
	if (pointerClickChannel?.readyState !== "open") return;
	if (isDown) triggerImmersiveMode();

	sharedView.setUint8(0, isDown ? 1 : 0); // isDown
	sharedView.setUint8(1, event.button);
	pointerClickChannel.send(sharedBytes.subarray(0, 2));
}

function onKeyButtonEvent(isDown, event) {
	event.preventDefault();
	if (keyboardTypeChannel?.readyState !== "open" || event.repeat) return;
	if (isDown) triggerImmersiveMode();

	if (!(event.code in codeMap)) {
		console.warn(`"${event.code}" does not have a corresponding value in code-map.json`);
		return;
	}

	sharedView.setUint8(0, isDown ? 1 : 0); // isDown
	sharedView.setUint8(1, codeMap[event.code]);

	keyboardTypeChannel.send(sharedBytes.subarray(0, 2));
}

function onResize(event /* unused */) {
	if (screenResizeChannel?.readyState !== "open") return;
	console.log("Sending screen resize packet...");

	sharedView.setUint32(0, window.innerWidth, true);
	sharedView.setUint32(4, window.innerHeight, true);
	screenResizeChannel.send(sharedBytes.subarray(0, 8));
}

function onScroll(event) {
	event.preventDefault();
	if (pointerScrollChannel?.readyState !== "open") return;

	sharedView.setUint8(0, event.deltaMode);
	sharedView.setFloat32(1, event.deltaX, true);
	sharedView.setFloat32(5, event.deltaY, true);
	sharedView.setFloat32(9, event.deltaZ, true); // unsupported in pynput
	pointerScrollChannel.send(sharedBytes.subarray(0, 13));
}