const wrtc = require("wrtc");
const { processAudio } = require("./MockAIService");

class BotPeer {
    constructor(clientId, sendSignal) {
        this.clientId = clientId;
        this.sendSignal = sendSignal;

        this.pc = new wrtc.RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        this.setup();
    }

    setup() {
        // Receive audio from client
        this.pc.ontrack = async (event) => {
            const stream = event.streams[0];

            console.log("Received audio from client");

            // Process via AI
            const responseStream = await processAudio(stream);

            // Send response audio back
            responseStream.getTracks().forEach(track => {
                this.pc.addTrack(track, responseStream);
            });
        };

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(this.clientId, {
                    type: "candidate",
                    candidate: event.candidate
                });
            }
        };
    }

    async handleOffer(offer) {
        await this.pc.setRemoteDescription(offer);

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        this.sendSignal(this.clientId, {
            type: "answer",
            answer
        });
    }

    async addCandidate(candidate) {
        await this.pc.addIceCandidate(candidate);
    }
}

module.exports = BotPeer;