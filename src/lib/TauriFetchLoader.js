import { dev_log } from "$lib";
// @ts-ignore
import shaka from "shaka-player/dist/shaka-player.compiled.js";

export class TauriFetchLoader {
  /**
   * @param {string} uri
   * @param {shaka.extern.Request} request
   * @param {shaka.net.NetworkingEngine.RequestType} requestType
   * @param {shaka.extern.ProgressUpdated} progressUpdated Called when a
   *   progress event happened.
   * @param {shaka.extern.HeadersReceived} headersReceived Called when the
   *   headers for the download are received, but before the body is.
   * @param {shaka.extern.SchemePluginConfig} config
   * @return {!shaka.extern.IAbortableOperation.<shaka.extern.Response>}
   * @export
   */
  static parse(
    uri,
    request,
    requestType,
    progressUpdated,
    headersReceived,
    config
  ) {
    const headers = new window.Headers();

    Object.entries(request.headers).forEach(([key, value]) => {
      headers.append(key, value);
    });

    const controller = new window.AbortController();

    /** @type {!RequestInit} */
    const init = {
      // Edge does not treat null as undefined for body; https://bit.ly/2luyE6x
      body: request.body || undefined,
      headers: headers,
      method: request.method,
      signal: controller.signal,
      credentials: request.allowCrossSiteCredentials ? "include" : undefined,
    };
    /** @type {TauriFetchLoader.AbortStatus} */
    const abortStatus = {
      canceled: false,
      timedOut: false,
    };
    const minBytes = config.minBytesForProgressEvents || 0;
    const pendingRequest = TauriFetchLoader.request_(
      uri,
      requestType,
      init,
      abortStatus,
      progressUpdated,
      headersReceived,
      request.streamDataCallback,
      minBytes
    );
    /** @type {!shaka.util.AbortableOperation} */
    const op = new shaka.util.AbortableOperation(pendingRequest, () => {
      abortStatus.canceled = true;
      controller.abort();
      return Promise.resolve();
    });
    // The fetch API does not timeout natively, so do a timeout manually using
    // the AbortController.
    const timeoutMs = request.retryParameters.timeout;
    if (timeoutMs) {
      const timer = new shaka.util.Timer(() => {
        abortStatus.timedOut = true;
        controller.abort();
      });
      timer.tickAfter(timeoutMs / 1000);
      // To avoid calling |abort| on the network request after it finished, we
      // will stop the timer when the requests resolves/rejects.
      op.finally(() => {
        timer.stop();
      });
    }
    return op;
  }
  /**
   * @param {string} uri
   * @param {shaka.net.NetworkingEngine.RequestType} requestType
   * @param {!RequestInit} init
   * @param {TauriFetchLoader.AbortStatus} abortStatus
   * @param {shaka.extern.ProgressUpdated} progressUpdated
   * @param {shaka.extern.HeadersReceived} headersReceived
   * @param {?function(BufferSource):!Promise} streamDataCallback
   * @param {number} minBytes
   * @return {!Promise<!shaka.extern.Response>}
   * @private
   */
  static async request_(
    uri,
    requestType,
    init,
    abortStatus,
    progressUpdated,
    headersReceived,
    streamDataCallback,
    minBytes
  ) {
    const { fetch } = await import("@tauri-apps/plugin-http");

    // @ts-ignore
    init.danger = {
      acceptInvalidCerts: true,
      acceptInvalidHostnames: true,
    };

    const ReadableStream = window.ReadableStream;
    let response;
    let arrayBuffer;
    let loaded = 0;
    let lastLoaded = 0;
    // Last time stamp when we got a progress event.
    let lastTime = Date.now();
    try {
      // The promise returned by fetch resolves as soon as the HTTP response
      // headers are available. The download itself isn't done until the promise
      // for retrieving the data (arrayBuffer, blob, etc) has resolved.
      response = await fetch(uri, init);
      // At this point in the process, we have the headers of the response, but
      // not the body yet.
      headersReceived(
        TauriFetchLoader.headersToGenericObject_(response.headers)
      );
      // In new versions of Chromium, HEAD requests now have a response body
      // that is null.
      // So just don't try to download the body at all, if it's a HEAD request,
      // to avoid null reference errors.
      // See: https://crbug.com/1297060
      if (init.method != "HEAD") {
        // Getting the reader in this way allows us to observe the process of
        // downloading the body, instead of just waiting for an opaque promise
        // to resolve.
        // We first clone the response because calling getReader locks the body
        // stream; if we didn't clone it here, we would be unable to get the
        // response's arrayBuffer later.
        const reader = response.clone().body.getReader();
        const contentLengthRaw = response.headers.get("Content-Length");
        const contentLength = contentLengthRaw
          ? parseInt(contentLengthRaw, 10)
          : 0;
        const start = (controller) => {
          const push = async () => {
            let readObj;
            try {
              readObj = await reader.read();
            } catch (e) {
              // If we abort the request, we'll get an error here.  Just ignore
              // it since real errors will be reported when we read the buffer
              // below.
              dev_log(e);
              return;
            }
            if (!readObj.done) {
              loaded += readObj.value.byteLength;
              if (streamDataCallback) {
                await streamDataCallback(readObj.value);
              }
            }
            const currentTime = Date.now();
            const chunkSize = loaded - lastLoaded;
            // If the time between last time and this time we got progress event
            // is long enough, or if a whole segment is downloaded, call
            // progressUpdated().
            if (
              (currentTime - lastTime > 100 && chunkSize >= minBytes) ||
              readObj.done
            ) {
              const numBytesRemaining = readObj.done
                ? 0
                : contentLength - loaded;
              progressUpdated(
                currentTime - lastTime,
                chunkSize,
                numBytesRemaining
              );
              lastLoaded = loaded;
              lastTime = currentTime;
            }
            if (readObj.done) {
              controller.close();
            } else {
              controller.enqueue(readObj.value);
              push();
            }
          };
          push();
        };
        // Create a ReadableStream to use the reader. We don't need to use the
        // actual stream for anything, though, as we are using the response's
        // arrayBuffer method to get the body, so we don't store the
        // ReadableStream.
        new ReadableStream({ start }); // eslint-disable-line no-new
        arrayBuffer = await response.arrayBuffer();
      }
    } catch (error) {
      if (abortStatus.canceled) {
        throw new shaka.util.Error(
          shaka.util.Error.Severity.RECOVERABLE,
          shaka.util.Error.Category.NETWORK,
          shaka.util.Error.Code.OPERATION_ABORTED,
          uri,
          requestType
        );
      } else if (abortStatus.timedOut) {
        throw new shaka.util.Error(
          shaka.util.Error.Severity.RECOVERABLE,
          shaka.util.Error.Category.NETWORK,
          shaka.util.Error.Code.TIMEOUT,
          uri,
          requestType
        );
      } else {
        throw new shaka.util.Error(
          shaka.util.Error.Severity.RECOVERABLE,
          shaka.util.Error.Category.NETWORK,
          shaka.util.Error.Code.HTTP_ERROR,
          uri,
          error,
          requestType
        );
      }
    }
    const headers = TauriFetchLoader.headersToGenericObject_(response.headers);
    return TauriFetchLoader.makeResponse(
      headers,
      arrayBuffer,
      response.status,
      uri,
      response.url,
      requestType
    );
  }
  /**
   * @param {!Headers} headers
   * @return {!Object.<String, String>}
   * @private
   */
  static headersToGenericObject_(headers) {
    const headersObj = {};
    headers.forEach((value, key) => {
      // Since Edge incorrectly return the header with a leading new line
      // character ('\n'), we trim the header here.
      headersObj[key.trim()] = value;
    });
    return headersObj;
  }

  static makeResponse(headers, data, status, uri, responseURL, requestType) {
    if (status >= 200 && status <= 299 && status != 202) {
      // Most 2xx HTTP codes are success cases.
      /** @type {shaka.extern.Response} */
      const response = {
        uri: responseURL || uri,
        originalUri: uri,
        data: data,
        status: status,
        headers: headers,
        fromCache: !!headers["x-shaka-from-cache"],
      };
      return response;
    } else {
      let responseText = null;
      try {
        responseText = shaka.util.StringUtils.fromBytesAutoDetect(data);
      } catch (exception) {}
      console.error("HTTP error text:", responseText);
      const severity =
        status == 401 || status == 403
          ? shaka.util.Error.Severity.CRITICAL
          : shaka.util.Error.Severity.RECOVERABLE;
      throw new shaka.util.Error(
        severity,
        shaka.util.Error.Category.NETWORK,
        shaka.util.Error.Code.BAD_HTTP_STATUS,
        uri,
        status,
        responseText,
        headers,
        requestType,
        responseURL || uri
      );
    }
  }

  /**
   * Always returns true, as this is the intended behaviour, otherwise why would you even use this loader?
   *
   * @return {boolean}
   * @export
   */
  static isSupported() {
    return true;
  }
}
/**
 * @typedef {{
 *   canceled: boolean,
 *   timedOut: boolean
 * }}
 * @property {boolean} canceled
 *   Indicates if the request was canceled.
 * @property {boolean} timedOut
 *   Indicates if the request timed out.
 */
TauriFetchLoader.AbortStatus;
