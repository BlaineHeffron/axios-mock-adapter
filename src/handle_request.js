"use strict";

var utils = require("./utils");

function transformRequest(data) {
  if (
    utils.isArrayBuffer(data) ||
    utils.isBuffer(data) ||
    utils.isStream(data) ||
    utils.isBlob(data)
  ) {
    return data;
  }

  // Object and Array: returns a deep copy
  if (utils.isObjectOrArray(data)) {
    return JSON.parse(JSON.stringify(data));
  }

  // for primitives like string, undefined, null, number
  return data;
}

function makeResponse(result, config) {
  return {
    status: result[0],
    data: transformRequest(result[1]),
    headers: result[2],
    config: config,
    request: {
      responseURL: config.url,
    },
  };
}

function passThroughRequest (mockAdapter, resolve, reject, config) {
  // Axios v0.17 mutates the url to include the baseURL for non hostnames
  // but does not remove the baseURL from the config
  var baseURL = config.baseURL;
  if (config.baseURL && !/^https?:/.test(config.baseURL)) {
    baseURL = undefined;
  }

  // Axios pre 1.2
  if (typeof mockAdapter.originalAdapter === 'function') {
    return mockAdapter.originalAdapter(config).then(resolve, reject);
  }

  mockAdapter.axiosInstanceWithoutInterceptors(Object.assign({}, config, {
    baseURL: baseURL,
    //  Use the original adapter, not the mock adapter
    adapter: mockAdapter.originalAdapter,
    // The request transformation runs on the original axios handler already
    transformRequest: [],
    transformResponse: []
  })).then(resolve, reject);
}

function handleRequest(mockAdapter, resolve, reject, config) {
  var url = config.url || "";
  console.log("config is ", JSON.stringify(config));
  // TODO we're not hitting this `if` in any of the tests, investigate
  if (
    config.baseURL &&
    url.substr(0, config.baseURL.length) === config.baseURL
  ) {
    url = url.slice(config.baseURL.length);
  }
  console.log("url is ", url);

  delete config.adapter;
  mockAdapter.history[config.method].push(config);

  console.log("Searching for handler with the following parameters:");
  console.log("Method:", config.method);
  console.log("URL:", url);
  console.log("Data:", config.data);
  console.log("Params:", config.params);
  console.log("Headers:", (config.headers && config.headers.constructor.name === 'AxiosHeaders')
    ? Object.assign({}, config.headers.toJSON())
    : config.headers);
  console.log("Base URL:", config.baseURL);

  var handler = utils.findHandler(
    mockAdapter.handlers,
    config.method,
    url,
    config.data,
    config.params,
    (config.headers && config.headers.constructor.name === 'AxiosHeaders')
      ? Object.assign({}, config.headers.toJSON())
      : config.headers,
    config.baseURL
  );

  console.log("Found handler:", handler ? "Yes" : "No");
  if (handler) {
    console.log("Handler details:", JSON.stringify(handler, null, 2));
  }

  if (handler) {
    if (handler[6] === true) {
      utils.purgeIfReplyOnce(mockAdapter, handler);
    }

    if (handler.length === 2) {
      // passThrough handler
      passThroughRequest(mockAdapter, resolve, reject, config);
    } else if (typeof handler[3] !== "function") {
      utils.settle(
        resolve,
        reject,
        makeResponse(handler.slice(3), config),
        getEffectiveDelay(mockAdapter, handler)
      );
    } else {
      var result = handler[3](config);
      // TODO throw a sane exception when return value is incorrect
      if (typeof result.then !== "function") {
        utils.settle(
          resolve,
          reject,
          makeResponse(result, config),
          getEffectiveDelay(mockAdapter, handler)
        );
      } else {
        result.then(
          function (result) {
            if (result.config && result.status) {
              utils.settle(
                resolve,
                reject,
                makeResponse(
                  [result.status, result.data, result.headers],
                  result.config
                ),
                0
              );
            } else {
              utils.settle(
                resolve,
                reject,
                makeResponse(result, config),
                getEffectiveDelay(mockAdapter, handler)
              );
            }
          },
          function (error) {
            if (mockAdapter.delayResponse > 0) {
              setTimeout(function () {
                reject(error);
              }, getEffectiveDelay(mockAdapter, handler));
            } else {
              reject(error);
            }
          }
        );
      }
    }
  } else {
    // handler not found
    switch (mockAdapter.onNoMatch) {
      case "passthrough":
        passThroughRequest(mockAdapter, resolve, reject, config);
        break;
      case "throwException":
        throw utils.createCouldNotFindMockError(config);
      default:
        utils.settle(
          resolve,
          reject,
          {
            status: 404,
            config: config,
          },
          mockAdapter.delayResponse
        );
    }
  }
}

function getEffectiveDelay(adapter, handler) {
  var delayPerRequest = handler[7];
  return typeof delayPerRequest === 'number' ? delayPerRequest : adapter.delayResponse;
}

module.exports = handleRequest;
