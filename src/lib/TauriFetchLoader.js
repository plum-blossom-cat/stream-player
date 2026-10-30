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
    const pendingRequest = TauriFetchLoader.request_(
      uri,
      requestType,
      init,
      abortStatus,
      headersReceived,
      request.streamDataCallback
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
   * @param {shaka.extern.HeadersReceived} headersReceived
   * @param {?function(BufferSource):!Promise} streamDataCallback
   * @return {!Promise<!shaka.extern.Response>}
   * @private
   */
  static async request_(
    uri,
    requestType,
    init,
    abortStatus,
    headersReceived,
    streamDataCallback
  ) {
    const { fetch } = await import("@tauri-apps/plugin-http");

    // @ts-ignore
    init.danger = {
      acceptInvalidCerts: true,
      acceptInvalidHostnames: true,
    };

    let response;
    let arrayBuffer;
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
        // Read the body once. Don't call progressUpdated: Shaka would then use
        // those partial samples for its bandwidth estimate instead of timing the
        // whole segment. They measure the Rust-to-JS bridge rather than the
        // network, and kept the estimate far too low, so adaptive quality never
        // climbed to the higher resolutions and frame rates.
        const chunks = [];
        let total = 0;
        const reader = response.body ? response.body.getReader() : null;
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.byteLength;
          if (streamDataCallback) {
            await streamDataCallback(value);
          }
        }
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        arrayBuffer = body.buffer;
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
