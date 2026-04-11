const wrtc = require("@roamhq/wrtc");
const WebSocket = require("ws");

// 🔧 Fix DNS issue on Windows
require("dns").setDefaultResultOrder("ipv4first");

require("dotenv").config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

class BotPeerOpenAIRealtime {
    constructor(clientId, sendSignal) {
        this.clientId = clientId;
        this.sendSignal = sendSignal;

        this.pc = new wrtc.RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        this.openaiWS = null;
        this.sink = null;

        // 🔊 Audio output (to client)
        this.audioSource = new wrtc.nonstandard.RTCAudioSource();
        this.audioTrack = this.audioSource.createTrack();

        this.stream = new wrtc.MediaStream();
        this.stream.addTrack(this.audioTrack);

        this.pc.addTrack(this.audioTrack, this.stream);
        // console.log("🎧 Audio track added");

        this.lastCommitTime = Date.now();

        this.audioBufferSize = 0;

        this.setup();
    }

    setup() {
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(this.clientId, {
                    type: "candidate",
                    candidate: event.candidate
                });
            }
        };

        this.pc.ontrack = (event) => {
            // console.log("🎤 Receiving audio from client");

            this.connectToOpenAI();

            const track = event.track;
            this.sink = new wrtc.nonstandard.RTCAudioSink(track);

            this.sink.ondata = (audioData) => {
                const pcm16 = downsample(audioData.samples);

                if (this.openaiWS?.readyState === WebSocket.OPEN) {

                    const base64 = Buffer.from(pcm16.buffer).toString("base64");

                    this.openaiWS.send(JSON.stringify({
                        type: "input_audio_buffer.append",
                        audio: base64
                    }));

                    // 🔥 track how much audio we sent
                    this.audioBufferSize += pcm16.length;

                    const now = Date.now();

                    // ✅ commit ONLY if enough audio
                    if (
                        this.audioBufferSize > 1600 &&   // ~100ms at 16kHz
                        now - this.lastCommitTime > 500 &&
                        !this.isResponding
                    ) {
                        // console.log("📤 committing audio");

                        this.openaiWS.send(JSON.stringify({
                            type: "input_audio_buffer.commit"
                        }));

                        this.openaiWS.send(JSON.stringify({
                            type: "response.create"
                        }));

                        this.lastCommitTime = now;
                        this.audioBufferSize = 0;
                        this.isResponding = true;
                    }
                }
            };
        };
    }

    connectToOpenAI() {
        this.openaiWS = new WebSocket(
            "wss://api.openai.com/v1/realtime?model=gpt-realtime",
            {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    "OpenAI-Beta": "realtime=v1"
                }
            }
        );

        this.openaiWS.on("open", () => {
            // console.log("✅ Connected to OpenAI Realtime");

            // 🎯 Configure behavior + audio output
            this.openaiWS.send(JSON.stringify({
                type: "session.update",
                session: {
                    instructions: `
You are an ICF-certified coach.
- Ask open-ended reflective questions
- Do not give direct advice
- Be empathetic and concise
`,
                    modalities: ["audio"],
                    voice: "alloy"
                }
            }));
        });

        this.openaiWS.on("message", (msg) => {
            const data = JSON.parse(msg.toString());

            // console.log("📩 EVENT:", data.type);

            // 🔊 AUDIO STREAM FROM OPENAI
            if (data.type === "response.audio.delta") {
                // console.log("🔊 received audio chunk");

                const audioBuffer = Buffer.from(data.delta, "base64");

                const int16 = new Int16Array(
                    audioBuffer.buffer,
                    audioBuffer.byteOffset,
                    audioBuffer.length / 2
                );

                // 🔥 FIX: UPSAMPLE 16k → 48k
                const upsampled = upsampleTo48k(int16);

                pushAudioInChunks(this.audioSource, upsampled);
            }

            if (data.type === "response.audio_transcript.delta") {
                process.stdout.write(data.delta);
            }

            if (data.type === "error") {
                console.error("❌ OpenAI error event:", data);
            }

            if (data.type === "response.output_text.done") {
                // console.log("🧠 Text:", data.text);
            }

            if (data.type === "response.completed") {
                // console.log("✅ response completed");
                this.isResponding = false;
            }
        });
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

    close() {
        if (this.sink) this.sink.stop();
        if (this.pc) this.pc.close();
        if (this.openaiWS) this.openaiWS.close();
    }
}

function pushAudioInChunks(audioSource, samples) {
    const FRAME_SIZE = 480;

    let offset = 0;

    // console.log("🎧 pushing frames:", samples.length);

    while (offset + FRAME_SIZE <= samples.length) {
        const chunk = samples.slice(offset, offset + FRAME_SIZE);

        audioSource.onData({
            samples: chunk,
            sampleRate: 48000,
            bitsPerSample: 16,
            channelCount: 1,
            numberOfFrames: FRAME_SIZE
        });

        offset += FRAME_SIZE;
    }
}

function upsampleTo48k(input) {
    const result = new Int16Array(input.length * 3);

    for (let i = 0; i < input.length; i++) {
        const sample = input[i];

        // simple nearest-neighbor upsampling
        result[i * 3] = sample;
        result[i * 3 + 1] = sample;
        result[i * 3 + 2] = sample;
    }

    return result;
}

/**
 * Downsample 48kHz → 16kHz
 */
function downsample(buffer, inputRate = 48000, outputRate = 16000) {
    const ratio = inputRate / outputRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Int16Array(newLength);

    let offset = 0;
    for (let i = 0; i < newLength; i++) {
        result[i] = buffer[Math.floor(offset)];
        offset += ratio;
    }

    return result;
}

module.exports = BotPeerOpenAIRealtime;