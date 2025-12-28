import { app } from "../../../scripts/app.js";
import { holafBridge } from "/extensions/ComfyUI-Holaf-Utilities/holaf_comfy_bridge.js";

/*
 * Listener for Holaf Profiler
 * Runs in the main ComfyUI window.
 * Listens for commands from the Profiler window via BroadcastChannel.
 */

app.registerExtension({
    name: "Holaf.Profiler.Listener",
    async setup() {
        console.log("[Holaf Profiler] Listener registered.");

        holafBridge.listen(async (data) => {
            if (!data || !data.type) return;

            // 1. Send Workflow Context to Backend
            if (data.type === 'get_workflow_for_profiler') {
                console.log("[Holaf Profiler] Request received: Sending workflow context...");
                
                // Serialize current graph
                const workflow = app.graph.serialize();
                
                // Send to backend
                try {
                    await fetch('/holaf/profiler/context', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(workflow)
                    });
                    console.log("[Holaf Profiler] Workflow context sent to backend.");
                } catch (e) {
                    console.error("[Holaf Profiler] Failed to send context:", e);
                }
            }
            
            // 2. Queue Prompt
            else if (data.type === 'queue_prompt') {
                console.log("[Holaf Profiler] Request received: Queueing prompt...");
                app.queuePrompt(0);
            }
        });
    }
});