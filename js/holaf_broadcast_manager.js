/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Broadcast Channel Manager
 *
 * Provides a simple, shared interface for communication between browser
 * windows/tabs of the same origin (e.g., main window and pop-out panels).
 */

const HOLAF_CHANNEL_NAME = 'holaf_utilities_main_channel';
let channel;

try {
    channel = new BroadcastChannel(HOLAF_CHANNEL_NAME);
} catch (e) {
    console.error("[Holaf Broadcast] BroadcastChannel API not supported.", e);
    // Fallback or disable pop-out feature if needed
    channel = {
        postMessage: () => console.warn("BroadcastChannel not supported: message not sent."),
        addEventListener: () => {},
        close: () => {}
    };
}


export const holafBroadcastManager = {
    /**
     * Subscribes to a specific message type on the channel.
     * @param {string} messageType - The type of message to listen for.
     * @param {function(object): void} callback - The function to execute with the message payload.
     */
    subscribe(messageType, callback) {
        const handler = (event) => {
            if (event.data && event.data.type === messageType) {
                callback(event.data.payload);
            }
        };
        channel.addEventListener('message', handler);
        // Return a function to unsubscribe
        return () => channel.removeEventListener('message', handler);
    },

    /**
     * Broadcasts a message to all listeners on the channel.
     * @param {string} messageType - The type of message being sent.
     * @param {object} payload - The data to send with the message.
     */
    broadcast(messageType, payload) {
        channel.postMessage({ type: messageType, payload });
    }
};