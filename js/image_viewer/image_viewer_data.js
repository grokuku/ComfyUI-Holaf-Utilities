export const PAGE_SIZE = 500;

const loadedRanges = new Set();      // starts de fenêtres chargées
const loadingRanges = new Map();     // start -> AbortController
const loadingPromises = new Map();   // start -> Promise

export function getWindowStart(index) {
    return Math.floor(index / PAGE_SIZE) * PAGE_SIZE;
}
export function isWindowLoaded(start) { return loadedRanges.has(start); }
export function isWindowLoading(start) { return loadingRanges.has(start); }
export function getLoadingPromise(start) { return loadingPromises.get(start) || null; }
export function registerLoading(start, controller, promise) {
    loadingRanges.set(start, controller);
    loadingPromises.set(start, promise);
}
export function unregisterLoading(start) {
    loadingRanges.delete(start);
    loadingPromises.delete(start);
}
export function setWindowLoaded(state, start, images) {
    for (let i = 0; i < images.length; i++) {
        state.images[start + i] = images[i];
    }
    state.images.length = Math.max(state.images.length, start + images.length);
    loadedRanges.add(start);
}
export function resetWindowCache() {
    for (const controller of loadingRanges.values()) controller.abort('window-reset');
    loadingRanges.clear();
    loadingPromises.clear();
    loadedRanges.clear();
}
export function getImageAt(state, index) {
    return state.images ? state.images[index] : undefined;
}
export function getMissingWindowStarts(startIndex, endIndex) {
    const starts = [];
    for (let w = getWindowStart(startIndex); w <= getWindowStart(endIndex); w += PAGE_SIZE) {
        if (!loadedRanges.has(w) && !loadingRanges.has(w)) starts.push(w);
    }
    return starts;
}
export function forEachLoadedImage(state, cb) {
    for (const start of [...loadedRanges].sort((a, b) => a - b)) {
        for (let i = start; i < Math.min(state.images.length, start + PAGE_SIZE); i++) {
            const img = state.images[i];
            if (img !== undefined) cb(img, i);
        }
    }
}
