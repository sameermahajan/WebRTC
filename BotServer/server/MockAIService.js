async function processAudio(inputStream) {
    console.log("Processing audio...");

    // TODO:
    // 1. Convert stream → PCM
    // 2. Send to STT API
    // 3. Run sentiment
    // 4. Generate TTS audio

    // For now: return SAME stream
    return inputStream;
}

module.exports = { processAudio };