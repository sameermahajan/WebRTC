const WebSocket = require("ws");
const BotPeer = require("./BotPeer");

const wss = new WebSocket.Server({ port: 8080 });

const clients = new Map();
const peers = new Map();

wss.on("connection", (ws) => {
    const clientId = Math.random().toString(36).substring(7);
    clients.set(clientId, ws);

    console.log("Client connected:", clientId);

    ws.on("message", async (msg) => {
        const data = JSON.parse(msg);

        // create bot peer if not exists
        if (!peers.has(clientId)) {
            peers.set(clientId, new BotPeer(clientId, sendToClient));
        }

        const peer = peers.get(clientId);

        if (data.type === "offer") {
            await peer.handleOffer(data.offer);
        }

        if (data.type === "candidate") {
            await peer.addCandidate(data.candidate);
        }
    });

    ws.on("close", () => {
        clients.delete(clientId);
        peers.delete(clientId);
        console.log("Client disconnected:", clientId);
    });
});

function sendToClient(clientId, message) {
    const ws = clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

console.log("Server running on ws://localhost:8080");
