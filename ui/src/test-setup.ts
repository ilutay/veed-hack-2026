import "@testing-library/react";

/**
 * Browser-API stubs for jsdom.
 *
 * We use none of these. Importing the `@tambo-ai/react` barrel pulls in
 * react-media-recorder -> media-encoder-host, which spins up a Worker off a
 * blob URL at module-evaluation time. jsdom implements neither API, so without
 * these stubs the suite fails to collect before a single test runs. This is
 * voice-recording machinery, entirely off the registry/renderer path.
 */
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:stub";
  URL.revokeObjectURL = () => {};
}

if (typeof globalThis.Worker === "undefined") {
  class StubWorker {
    onmessage: unknown = null;
    onerror: unknown = null;
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
  }
  globalThis.Worker = StubWorker as unknown as typeof Worker;
}
