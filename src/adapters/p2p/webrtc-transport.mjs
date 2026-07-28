// One WebRTC DataChannel between two browsers, and nothing else. The caller
// carries the offer and answer SDP strings between the two machines however it
// likes — a link, a paste, an already-open channel to a third peer — and this
// module never learns what travels over the channel once it is open: it takes
// plain JS values in and hands plain JS values out.
//
// `connectionState` is a live GETTER PROPERTY, not a method: read
// `transport.connectionState`, never `transport.connectionState()`. It reports
// RTCPeerConnection's own state ("new" | "connecting" | "connected" | "failed"
// | "closed"), so a caller can poll it without registering a handler.
//
// `iceServers` defaults to [] and this design keeps it empty: no STUN, no
// TURN, no third party in the loop at all. Peers that cannot already reach
// each other directly (same machine, same LAN, or a NAT that allows it) never
// finish the handshake, which is the stated boundary of staying serverless.
//
// Both `createOffer` and `createAnswerFor` resolve only once ICE gathering has
// completed, so the SDP string they return already carries every candidate.
// Nothing here trickles, because a pasted blob is a one-shot message rather
// than a live connection back to the other side.
//
// Late handler registration still fires: `onOpen` on an already-open channel
// and `onClose` on an already-closed one call back immediately, so a caller
// that registers after the transition never silently misses it. Each fires at
// most once.

const CHANNEL_LABEL = "tmct";

export function createTransport({ iceServers = [] } = {}) {
  const PeerConnection = globalThis.RTCPeerConnection;
  if (typeof PeerConnection !== "function") {
    throw new Error("no RTCPeerConnection here: this transport runs in a browser, not in bare node");
  }

  const connection = new PeerConnection({ iceServers });
  const messageHandlers = [];
  const openHandlers = [];
  const closeHandlers = [];

  let channel = null;
  let openAnnounced = false;
  let closeAnnounced = false;
  let tornDown = false;

  function announceOpen() {
    if (openAnnounced) return;
    openAnnounced = true;
    for (const handler of openHandlers) handler();
  }

  function announceClose() {
    if (closeAnnounced) return;
    closeAnnounced = true;
    for (const handler of closeHandlers) handler();
  }

  function receive(event) {
    let value;
    try {
      value = JSON.parse(event.data);
    } catch {
      // A peer sending something that isn't JSON must not be able to throw
      // inside our receive path, so the frame is dropped rather than raised.
      return;
    }
    for (const handler of messageHandlers) handler(value);
  }

  function attachChannel(dataChannel) {
    channel = dataChannel;
    dataChannel.addEventListener("open", announceOpen);
    dataChannel.addEventListener("close", announceClose);
    dataChannel.addEventListener("message", receive);
    if (dataChannel.readyState === "open") announceOpen();
  }

  connection.addEventListener("datachannel", (event) => attachChannel(event.channel));
  connection.addEventListener("connectionstatechange", () => {
    const state = connection.connectionState;
    if (state === "failed" || state === "closed") announceClose();
  });

  async function whenIceGatheringCompletes() {
    if (connection.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      const settle = () => {
        if (connection.iceGatheringState !== "complete") return;
        connection.removeEventListener("icegatheringstatechange", settle);
        resolve();
      };
      connection.addEventListener("icegatheringstatechange", settle);
    });
  }

  return {
    async createOffer() {
      attachChannel(connection.createDataChannel(CHANNEL_LABEL));
      await connection.setLocalDescription(await connection.createOffer());
      await whenIceGatheringCompletes();
      return connection.localDescription.sdp;
    },

    async createAnswerFor(offerSdp) {
      await connection.setRemoteDescription({ type: "offer", sdp: offerSdp });
      await connection.setLocalDescription(await connection.createAnswer());
      await whenIceGatheringCompletes();
      return connection.localDescription.sdp;
    },

    async completeWithAnswer(answerSdp) {
      await connection.setRemoteDescription({ type: "answer", sdp: answerSdp });
    },

    send(data) {
      const state = channel ? channel.readyState : "missing";
      if (state !== "open") throw new Error(`cannot send over a data channel that is ${state}`);
      channel.send(JSON.stringify(data));
    },

    onMessage(handler) {
      messageHandlers.push(handler);
    },

    onOpen(handler) {
      openHandlers.push(handler);
      if (openAnnounced) handler();
    },

    onClose(handler) {
      closeHandlers.push(handler);
      if (closeAnnounced) handler();
    },

    close() {
      if (tornDown) return;
      tornDown = true;
      channel?.close();
      connection.close();
      announceClose();
    },

    get connectionState() {
      return connection.connectionState;
    },
  };
}
