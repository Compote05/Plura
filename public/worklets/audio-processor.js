class AudioChunkProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = new Float32Array(512);
        this._index = 0;
    }

    process(inputs) {
        const channel = inputs[0]?.[0];
        if (!channel) return true;

        for (let i = 0; i < channel.length; i++) {
            this._buffer[this._index++] = channel[i];
            if (this._index === 512) {
                this.port.postMessage(this._buffer.slice());
                this._index = 0;
            }
        }

        return true;
    }
}

registerProcessor("audio-chunk-processor", AudioChunkProcessor);
