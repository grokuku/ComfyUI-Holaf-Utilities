/*
 * Holaf Utilities - ComfyUI Bridge
 * Handles communication between the main ComfyUI tab and the Standalone Gallery tab.
 */

const CHANNEL_NAME = 'holaf_comfy_bridge';

export class HolafComfyBridge {
    constructor() {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.listeners = [];

        this.channel.onmessage = (event) => {
            if (event.data && event.data.type) {
                this._notifyListeners(event.data);
            }
        };
    }

    /**
     * Sends a command to other tabs.
     * @param {string} type - Message type (e.g. 'LOAD_WORKFLOW', 'LOAD_PROMPT')
     * @param {object} payload - The data to send.
     */
    send(type, payload) {
        this.channel.postMessage({ type, payload });
    }

    /**
     * Registers a callback to handle incoming messages.
     * @param {function} callback - Function(data)
     */
    listen(callback) {
        this.listeners.push(callback);
    }

    _notifyListeners(data) {
        this.listeners.forEach(cb => cb(data));
    }
}

// Singleton instance
export const holafBridge = new HolafComfyBridge();