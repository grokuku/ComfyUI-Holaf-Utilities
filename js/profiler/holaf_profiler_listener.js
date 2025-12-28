import { app } from "../../../scripts/app.js";
import { holafBridge } from "/extensions/ComfyUI-Holaf-Utilities/holaf_comfy_bridge.js";

/*
 * Listener for Holaf Profiler
 * Runs in the main ComfyUI window.
 */

app.registerExtension({
    name: "Holaf.Profiler.Listener",
    async setup() {
        console.log("[Holaf Profiler] Listener registered.");

        holafBridge.listen(async (data) => {
            if (!data || !data.type) return;

            // 1. Send Workflow Context to Backend
            if (data.type === 'get_workflow_for_profiler') {
                console.log("[Holaf Profiler] Syncing...");
                
                // Get Live Objects (Source of Truth for positions)
                const liveNodes = app.graph._nodes || [];
                const liveGroups = app.graph._groups || [];

                // Debug Log for troubleshooting
                if (liveGroups.length > 0) {
                    const g = liveGroups[0];
                    console.log(`[Debug] Group 0 '${g.title}': [${g.pos[0]}, ${g.pos[1]}] Size: [${g.size[0]}, ${g.size[1]}]`);
                    if (liveNodes.length > 0) {
                        const n = liveNodes[0];
                        console.log(`[Debug] Node 0 '${n.title}': [${n.pos[0]}, ${n.pos[1]}]`);
                    }
                }

                // Serialize for Backend
                const workflow = app.graph.serialize();
                
                // --- HOLAF ENHANCEMENT: Inject Group Info ---
                if (workflow.nodes) {
                    workflow.nodes.forEach(node => {
                        // Find the corresponding LIVE node to get accurate screen coords
                        const liveNode = liveNodes.find(n => n.id == node.id);
                        if (!liveNode) return;

                        const nx = liveNode.pos[0];
                        const ny = liveNode.pos[1];
                        // Calculate center of node for better hit testing
                        const nodeCenterX = nx + (liveNode.size[0] / 2);
                        const nodeCenterY = ny + (liveNode.size[1] / 2);

                        // Find group
                        for (const g of liveGroups) {
                            const gx = g.pos[0];
                            const gy = g.pos[1];
                            const gw = g.size[0];
                            const gh = g.size[1];

                            // Check if Node Center is inside Group Rect
                            if (nodeCenterX >= gx && nodeCenterX <= (gx + gw) &&
                                nodeCenterY >= gy && nodeCenterY <= (gy + gh)) {
                                
                                node.holaf_group = g.title;
                                break; // Stop at first match
                            }
                        }
                    });
                }
                // --------------------------------------------

                try {
                    await fetch('/holaf/profiler/context', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(workflow)
                    });
                    console.log("[Holaf Profiler] Context sent.");
                } catch (e) {
                    console.error("[Holaf Profiler] Sync failed:", e);
                }
            }
            
            // 2. Queue Prompt
            else if (data.type === 'queue_prompt') {
                console.log("[Holaf Profiler] Queueing prompt...");
                app.queuePrompt(0);
            }
        });
    }
});